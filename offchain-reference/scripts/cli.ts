// @meshsdk/transaction loads libsodium-wrappers-sumo as a side effect. Under
// Node 22, its deferred WASM .ready callback can throw "libsodium was not
// correctly initialized" as an unhandled rejection and crash the process.
// Suppress it here so it doesn't interfere with normal operation.
process.on("unhandledRejection", (reason) => {
  if (
    reason instanceof Error &&
    reason.message === "libsodium was not correctly initialized."
  ) {
    return;
  }
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});

import { parseArgs } from "node:util";
import { createTimelockedMP, mintNFTs } from "../lib/mint.js";
import type { MediaAssets, Royalty, TxBuild } from "../lib/common/index.js";
import { BlockfrostProvider } from "@meshsdk/provider";
import type { PlutusScript } from "@meshsdk/common";
// See set-collateral.ts for why we await the *nested* sodium instance.
// @ts-ignore – nested package has no .d.ts; types come from @types/libsodium-wrappers-sumo
import internalSodium from "../node_modules/@meshsdk/core-cst/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js";
import {
  applyParamsToScript,
  resolvePlutusScriptAddress,
  resolvePlutusScriptHash,
  VkeyWitness,
  HexBlob,
  resolveTxHash,
  deserializeTxHash,
  Ed25519PrivateKey,
  Ed25519PrivateExtendedKeyHex,
  CostModel,
  Costmdls,
  Transaction,
  TxCBOR,
  CborWriter,
  blake2b,
  Hash32ByteBase16,
} from "@meshsdk/core-cst";
import { WalletStaticMethods } from "@meshsdk/wallet";
import { bech32 } from "bech32";
import { getEnv } from "./env.js";
import { extractRoyaltyInfo } from "../lib/read.js";
import { writeFileSync, readFileSync } from "fs";
import { createInterface } from "node:readline";

const contracts = JSON.parse(
  readFileSync(
    new URL("../../onchain-reference/plutus.json", import.meta.url),
    "utf-8",
  ),
);

// ── Help text ────────────────────────────────────────────────────────────────

const HELP = `
Usage: cli <command> [options]

Commands:
  mint-collection   Mint a timelocked CIP-68 NFT collection with a CIP-102 royalty
  get-royalties     Read royalty information for a given policy ID

mint-collection options:
  --name <string>              Base name for the NFT assets           [required]
  --image <url>                IPFS URL for the NFT image             [required]
  --deadline <ISO date>        Deadline for the timelocked minting policy
                               e.g. 2027-12-22T23:59:59Z             [required]
  --size <number>              Number of NFTs to mint                 [default: 1]
  --fee <percent>              Royalty fee percentage (e.g. 1.6)      [required]
  --royalty-address <address>  Royalty recipient address  [default: WALLET_ADDRESS]

get-royalties options:
  --policy-id <id>             Policy ID to query royalties for       [required]
  (or pass the policy ID as a positional: get-royalties <policy-id>)

Global options:
  --help, -h                   Show this help message
`.trim();

// ── Parse argv ───────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    // mint-collection
    name: { type: "string" },
    image: { type: "string" },
    deadline: { type: "string" },
    size: { type: "string" },
    fee: { type: "string" },
    "royalty-address": { type: "string" },
    // get-royalties
    "policy-id": { type: "string" },
    // global
    help: { type: "boolean", short: "h" },
  },
});

const command = positionals[0];

if (values.help || !command) {
  console.log(HELP);
  process.exit(0);
}

// ── Environment ──────────────────────────────────────────────────────────────

const projectId = getEnv("BLOCKFROST_PROJECT_KEY");
const cardanoNetwork = getEnv("PUBLIC_CARDANO_NETWORK");
const walletAddress = getEnv("WALLET_ADDRESS");
const privateKey = getEnv("WALLET_PRIVATE_KEY");
const networkId = cardanoNetwork === "mainnet" ? 1 : 0;

await internalSodium.ready;

const provider = new BlockfrostProvider(projectId);

// ── Contract helpers ─────────────────────────────────────────────────────────

const alwaysFails = (key: string): PlutusScript => ({
  version: "V2",
  code: applyParamsToScript(
    contracts.validators.find((v: any) => v.title === "always_fails.spend")
      ?.compiledCode ?? "",
    [key],
  ),
});

const timelockedMP: PlutusScript = {
  version: "V2",
  code:
    contracts.validators.find(
      (v: any) => v.title === "minting.minting_validator",
    )?.compiledCode ?? "",
};

// ── Command dispatch ─────────────────────────────────────────────────────────

main()
  .then(console.log)
  .catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

async function main(): Promise<unknown> {
  switch (command) {
    case "mint-collection":
      return runMintCollection();

    case "get-royalties":
      return runGetRoyalties();

    default:
      console.error(`Unknown command: "${command}"\n`);
      console.log(HELP);
      process.exit(1);
  }
}

// ── mint-collection ──────────────────────────────────────────────────────────

async function runMintCollection(): Promise<unknown> {
  // Validate required options
  const missing: string[] = [];
  if (!values.name) missing.push("--name");
  if (!values.image) missing.push("--image");
  if (!values.deadline) missing.push("--deadline");
  if (!values.fee) missing.push("--fee");
  if (missing.length) {
    console.error(
      `mint-collection: missing required options: ${missing.join(", ")}\n`,
    );
    console.log(HELP);
    process.exit(1);
  }

  const name = values.name!;
  const image = values.image!;
  const deadline = new Date(values.deadline!);
  const size = values.size !== undefined ? parseInt(values.size, 10) : 1;
  const fee = parseFloat(values.fee!);
  const royaltyAddress = values["royalty-address"] ?? walletAddress;

  if (isNaN(deadline.getTime())) {
    console.error(
      `mint-collection: invalid --deadline value "${values.deadline}". Use ISO 8601 format, e.g. 2027-12-22T23:59:59Z`,
    );
    process.exit(1);
  }
  if (isNaN(size) || size < 1) {
    console.error(`mint-collection: --size must be a positive integer`);
    process.exit(1);
  }
  if (isNaN(fee) || fee <= 0) {
    console.error(`mint-collection: --fee must be a positive number`);
    process.exit(1);
  }

  const validatorScriptHash = resolvePlutusScriptHash(
    resolvePlutusScriptAddress(timelockedMP, networkId),
  );
  const validator = alwaysFails(validatorScriptHash);
  const parameterizedMp = createTimelockedMP(
    timelockedMP.code,
    deadline.getTime(),
    walletAddress,
  );

  const assets: MediaAssets = {};
  for (let i = 0; i < size; i++) {
    assets[name + i] = { name: name + i, image };
  }

  const royalty: Royalty = { address: royaltyAddress, fee };

  return runTx(() =>
    mintNFTs(
      provider,
      walletAddress,
      parameterizedMp,
      validator,
      assets,
      royalty,
    ),
  );
}

// ── get-royalties ────────────────────────────────────────────────────────────

async function runGetRoyalties(): Promise<unknown> {
  // Accept --policy-id <id> or a bare positional (npm eats -- flags without --)
  const policyId = values["policy-id"] ?? positionals[1];
  if (!policyId) {
    console.error(`get-royalties: missing required argument: policy-id\n`);
    console.log(HELP);
    process.exit(1);
  }
  return extractRoyaltyInfo(provider, policyId, networkId);
}

// ── Shared tx utilities ──────────────────────────────────────────────────────

async function runTx(txBuilder: () => Promise<TxBuild>): Promise<unknown> {
  const txBuild = await txBuilder();
  if (!txBuild.tx) {
    return txBuild.error;
  }

  const unsignedTxHex = await txBuild.tx.complete();
  const patchedTxHex = await patchScriptDataHash(provider, unsignedTxHex);

  const confirmed = await confirm("Submit transaction? [y/N] ");
  if (!confirmed) {
    console.log("Aborted.");
    process.exit(0);
  }

  const keyBytes = Buffer.from(
    bech32.fromWords(bech32.decode(privateKey, 1000).words),
  );
  const signer = Ed25519PrivateKey.fromExtendedHex(
    Ed25519PrivateExtendedKeyHex(keyBytes.toString("hex")),
  );
  const txHash = deserializeTxHash(resolveTxHash(patchedTxHex));
  const witness = new VkeyWitness(
    signer.toPublic().hex(),
    signer.sign(HexBlob(txHash)).hex(),
  );
  const signedCbor = WalletStaticMethods.addWitnessSets(patchedTxHex, [
    witness,
  ]).toString();

  writeFileSync("signed-tx.cbor", signedCbor);
  console.log("signed CBOR written to signed-tx.cbor");
  return provider.submitTx(signedCbor);
}

function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function patchScriptDataHash(
  provider: BlockfrostProvider,
  txHex: string,
): Promise<string> {
  const tx = Transaction.fromCbor(TxCBOR(txHex));
  const witnessSet = tx.witnessSet();
  const redeemers = witnessSet.redeemers();

  if (!redeemers || redeemers.size() === 0) return txHex;

  const v1Scripts = witnessSet.plutusV1Scripts();
  const v2Scripts = witnessSet.plutusV2Scripts();
  const v3Scripts = witnessSet.plutusV3Scripts();
  const hasV1 = v1Scripts != null && v1Scripts.size() > 0;
  const hasV2 = v2Scripts != null && v2Scripts.size() > 0;
  const hasV3 = v3Scripts != null && v3Scripts.size() > 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (provider as any)._axiosInstance.get(
    "epochs/latest/parameters",
  );
  const rawModels = data.cost_models_raw as
    | Record<string, number[] | Record<string, number>>
    | undefined;

  if (!rawModels) {
    console.warn("Blockfrost returned no cost_models_raw – using tx as-is");
    return txHex;
  }

  console.log("cost_models_raw keys:", Object.keys(rawModels));

  const toList = (
    v: number[] | Record<string, number> | undefined,
  ): number[] | undefined => {
    if (!v) return undefined;
    if (Array.isArray(v)) return v;
    return Object.values(v);
  };

  const costModels = new Costmdls();
  const v1List = toList(rawModels["PlutusV1"]);
  const v2List = toList(rawModels["PlutusV2"]);
  const v3List = toList(rawModels["PlutusV3"]);
  if (hasV1 && v1List) costModels.insert(CostModel.newPlutusV1(v1List));
  if (hasV2 && v2List) costModels.insert(CostModel.newPlutusV2(v2List));
  if (hasV3 && v3List) costModels.insert(CostModel.newPlutusV3(v3List));

  const datums = witnessSet.plutusData();
  const EMPTY_MAP = new Uint8Array([0xa0]);
  const writer = new CborWriter();

  if (datums && datums.size() > 0 && redeemers.size() === 0) {
    writer.writeEncodedValue(EMPTY_MAP);
    writer.writeEncodedValue(Buffer.from(datums.toCbor(), "hex"));
    writer.writeEncodedValue(EMPTY_MAP);
  } else {
    writer.writeEncodedValue(Buffer.from(redeemers.toCbor(), "hex"));
    if (datums && datums.size() > 0) {
      writer.writeEncodedValue(Buffer.from(datums.toCbor(), "hex"));
    }
    writer.writeEncodedValue(
      Buffer.from(costModels.languageViewsEncoding(), "hex"),
    );
  }

  const newHash = blake2b.hash(writer.encodeAsHex(), 32) as Hash32ByteBase16;
  const body = tx.body();
  body.setScriptDataHash(newHash);
  tx.setBody(body);
  return tx.toCbor().toString();
}
