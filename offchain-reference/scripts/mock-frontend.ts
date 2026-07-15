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

import { createTimelockedMP, mintNFTs } from "../lib/mint.js";
import type { MediaAssets, Royalty, TxBuild } from "../lib/common/index.js";
import { BlockfrostProvider } from "@meshsdk/provider";
import type { PlutusScript } from "@meshsdk/common";
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
  // script-data-hash patching utilities
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
import { writeFileSync } from "fs";

import { readFileSync } from "fs";
const contracts = JSON.parse(
  readFileSync(
    new URL("../../onchain-reference/plutus.json", import.meta.url),
    "utf-8",
  ),
);

/**
 * MAIN
 * Sets up a mock frontend with a collection of required variables
 * Then selects an action based on the parameter passed in by the user
 */

const purpose = process.argv[2];

// get environment variables
const projectId = getEnv("BLOCKFROST_PROJECT_KEY");
const cardanoNetwork = getEnv("PUBLIC_CARDANO_NETWORK");
const walletAddress = getEnv("WALLET_ADDRESS");
const privateKey = getEnv("WALLET_PRIVATE_KEY");
const networkId = cardanoNetwork === "mainnet" ? 1 : 0;

// set up a Blockfrost-connected provider
const provider = new BlockfrostProvider(projectId);

// isolate the contracts' cbor
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

// interpret the user input and execute the requested action
selectAction().then(console.log);

// Frontend Utilities

/**
 * Utility to select an action based on the purpose parameter passed in by the user
 */
async function selectAction() {
  switch (purpose) {
    case "mint-collection": {
      const validatorScriptHash = resolvePlutusScriptHash(
        resolvePlutusScriptAddress(timelockedMP, networkId),
      );
      const validator = alwaysFails(validatorScriptHash);
      return await runTx(() =>
        testTimelockedMint(timelockedMP, validator, walletAddress),
      );
    }
    case "get-royalties":
      return await extractRoyaltyInfo(provider, process.argv[3], networkId);
    default:
      return { error: "no transaction selected" };
  }
}

/**
 * A simple function to attempt to build a tx, sign it, and submit it to the blockchain
 * @param txBuilder the frontend transaction builder
 */
async function runTx(txBuilder: () => Promise<TxBuild>) {
  const txBuild = await txBuilder();
  if (!txBuild.tx) {
    return txBuild.error;
  } else {
    // Build the unsigned transaction
    const unsignedTxHex = await txBuild.tx.complete();

    // MeshJS hardens cost models inside the script_data_hash using its
    // bundled defaults, which may differ from the live network values.
    // Re-fetch the real cost models from Blockfrost and patch the hash.
    const patchedTxHex = await patchScriptDataHash(provider, unsignedTxHex);

    // WALLET_PRIVATE_KEY is always an ed25519e_sk bech32 (64-byte extended
    // Ed25519 key produced by generate-wallet via BIP32 derivation).
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
    const submittedTxHash = await provider.submitTx(signedCbor);
    return submittedTxHash;
  }
}

/**
 * Fetches live cost models from Blockfrost and patches the script_data_hash
 * in the serialised unsigned transaction.
 *
 * MeshJS bundles hardcoded default cost models that are frequently outdated
 * relative to the active network.  Any mismatch causes the node to reject
 * with PPViewHashesDontMatch.  We re-derive the hash using the real values
 * obtained from /epochs/latest/parameters just before signing.
 */
async function patchScriptDataHash(
  provider: BlockfrostProvider,
  txHex: string,
): Promise<string> {
  // Decode the unsigned transaction.
  const tx = Transaction.fromCbor(TxCBOR(txHex));
  const witnessSet = tx.witnessSet();
  const redeemers = witnessSet.redeemers();

  // No Plutus scripts → no script_data_hash needed.
  if (!redeemers || redeemers.size() === 0) return txHex;

  // ── Determine which Plutus language versions are used ─────────────────────
  const v1Scripts = witnessSet.plutusV1Scripts();
  const v2Scripts = witnessSet.plutusV2Scripts();
  const v3Scripts = witnessSet.plutusV3Scripts();
  const hasV1 = v1Scripts != null && v1Scripts.size() > 0;
  const hasV2 = v2Scripts != null && v2Scripts.size() > 0;
  const hasV3 = v3Scripts != null && v3Scripts.size() > 0;

  // ── Fetch the live cost models from Blockfrost ─────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (provider as any)._axiosInstance.get(
    "epochs/latest/parameters",
  );
  // Blockfrost may return cost_models_raw as arrays or as integer-keyed objects.
  const rawModels = data.cost_models_raw as
    | Record<string, number[] | Record<string, number>>
    | undefined;

  if (!rawModels) {
    console.warn("Blockfrost returned no cost_models_raw – using tx as-is");
    return txHex;
  }

  // Log available keys to help debug key-name mismatches across eras/networks.
  console.log("cost_models_raw keys:", Object.keys(rawModels));

  // Normalise to a flat number[] regardless of Blockfrost's exact shape.
  const toList = (
    v: number[] | Record<string, number> | undefined,
  ): number[] | undefined => {
    if (!v) return undefined;
    if (Array.isArray(v)) return v;
    // Integer-keyed object: Object.values order is numeric ascending – correct.
    return Object.values(v);
  };

  // ── Build Costmdls from the live values ────────────────────────────────────
  const costModels = new Costmdls();
  const v1List = toList(rawModels["PlutusV1"]);
  const v2List = toList(rawModels["PlutusV2"]);
  const v3List = toList(rawModels["PlutusV3"]);
  if (hasV1 && v1List) costModels.insert(CostModel.newPlutusV1(v1List));
  if (hasV2 && v2List) costModels.insert(CostModel.newPlutusV2(v2List));
  if (hasV3 && v3List) costModels.insert(CostModel.newPlutusV3(v3List));

  // ── Recompute script_data_hash (same algorithm as @meshsdk/core-cst) ───────
  const datums = witnessSet.plutusData();
  const EMPTY_MAP = new Uint8Array([0xa0]); // CBOR empty map {}
  const writer = new CborWriter();

  if (datums && datums.size() > 0 && redeemers.size() === 0) {
    // Only datums, no redeemers (shouldn't happen here, but handle it)
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

  // ── Patch the tx body and re-serialise ────────────────────────────────────
  const body = tx.body();
  body.setScriptDataHash(newHash);
  tx.setBody(body);
  return tx.toCbor().toString();
}

/**
 *  Examples of constructing transactions from the frontend using the endpoints defined in this library.
 *   - testTimelockedMint: a collection with CIP 68 NFTs and a CIP 102 royalty
 * */

function testTimelockedMint(
  mp: PlutusScript,
  validator: PlutusScript,
  walletAddress: string,
): Promise<TxBuild> {
  // configuration - these would come from user input. Adjust these however you wish.
  const mock_image = "ipfs://QmeTkA5bY4P3DUjhdtPc2MsT8G8keb7HAxjccKrLJN2xTz";
  const mock_name = "test";
  const mock_deadline = new Date("2027-12-22T23:59:59Z").getTime();
  const mock_size = 5;
  const mock_fee = 1.6;

  // parameterize minting policy
  const parameterized_mp = createTimelockedMP(
    mp.code,
    mock_deadline,
    walletAddress,
  );

  // define media assets for each nft
  const assets: MediaAssets = {};
  for (let i = 0; i < mock_size; i++) {
    const tempdetails = {
      name: mock_name + i,
      image: mock_image,
    };
    assets[mock_name + i] = tempdetails;
  }

  // define royalty policy
  const royalties: Royalty[] = [
    {
      address: walletAddress,
      fee: mock_fee,
    },
  ];

  return mintNFTs(
    provider,
    walletAddress,
    parameterized_mp,
    validator,
    assets,
    royalties[0],
  );
}
