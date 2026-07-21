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

    // WALLET_PRIVATE_KEY is always an ed25519e_sk bech32 (64-byte extended
    // Ed25519 key produced by generate-wallet via BIP32 derivation).
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
    const submittedTxHash = await provider.submitTx(signedCbor);
    return submittedTxHash;
  }
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
