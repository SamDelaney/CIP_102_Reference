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
  resolvePaymentKeyHash,
  VkeyWitness,
  HexBlob,
  resolveTxHash,
  deserializeTxHash,
  Ed25519PrivateKey,
  Ed25519PrivateExtendedKeyHex,
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
  --ref-address <address>      Address to send reference (100) tokens to
                               [default: alwaysFails script parameterized by PKH]
  --royalty-postfix <n>        CIP-102 v2 royalty token postfix (positive integer).
                               Mints (500)Royalty<n> with datum version 2 instead
                               of the v1 base (500)Royalty token.

get-royalties options:
  --policy-id <id>             Policy ID to query royalties for       [required]
  (or pass the policy ID as a positional: get-royalties <policy-id>)
  --royalty-postfix <n>        Look up the CIP-102 v2 (500)Royalty<n> token
                               instead of the v1 base (500)Royalty token.

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
    "ref-address": { type: "string" },
    "royalty-postfix": { type: "string" },
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

// Parses a CLI flag as a strictly positive integer. Rejects any non-digit input
// (e.g. "1.5", "2e3", "-1", " 3") instead of silently truncating the way
// parseInt would. Returns undefined when the flag was not supplied.
function parsePositiveIntFlag(
  raw: string | undefined,
  command: string,
  flag: string,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    console.error(`${command}: ${flag} must be a positive integer`);
    process.exit(1);
  }
  return parseInt(raw, 10);
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
  version: "V3",
  code: applyParamsToScript(
    contracts.validators.find(
      (v: any) => v.title === "always_fails.always_fails.spend",
    )?.compiledCode ?? "",
    [key],
  ),
});

const timelockedMP: PlutusScript = {
  version: "V3",
  code:
    contracts.validators.find(
      (v: any) => v.title === "minting.minting_validator.mint",
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
  const refAddress = values["ref-address"];
  const royaltyPostfix = parsePositiveIntFlag(
    values["royalty-postfix"],
    "mint-collection",
    "--royalty-postfix",
  );

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

  const paymentKeyHash = resolvePaymentKeyHash(walletAddress);
  const validator = alwaysFails(paymentKeyHash);
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
      refAddress,
      royaltyPostfix,
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
  const royaltyPostfix = parsePositiveIntFlag(
    values["royalty-postfix"],
    "get-royalties",
    "--royalty-postfix",
  );
  return extractRoyaltyInfo(provider, policyId, networkId, royaltyPostfix);
}

// ── Shared tx utilities ──────────────────────────────────────────────────────

async function runTx(txBuilder: () => Promise<TxBuild>): Promise<unknown> {
  const txBuild = await txBuilder();
  if (!txBuild.tx) {
    return txBuild.error;
  }

  const unsignedTxHex = await txBuild.tx.complete();

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
  const txHash = deserializeTxHash(resolveTxHash(unsignedTxHex));
  const witness = new VkeyWitness(
    signer.toPublic().hex(),
    signer.sign(HexBlob(txHash)).hex(),
  );
  const signedCbor = WalletStaticMethods.addWitnessSets(unsignedTxHex, [
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
