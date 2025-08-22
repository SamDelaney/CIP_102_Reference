import { createTimelockedMP, mintNFTs } from "../lib/mint.js";
import { MediaAssets, Royalty, TxBuild } from "../lib/common/index.js";
import {
  Lucid,
  Blockfrost,
  Network,
  Script,
  PlutusVersion,
  applyParamsToScript,
  LucidEvolution,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { getEnv } from "./env.js";
import { extractRoyaltyInfo } from "../lib/read.js";

import { readFileSync } from "fs";
const contracts = JSON.parse(
  readFileSync(
    new URL("../../onchain-reference/plutus.json", import.meta.url),
    "utf-8"
  )
);

/**
 * MAIN
 * Sets up a mock frontend with a collection of required variables
 * Then selects an action based on the parameter passed in by the user
 */

const purpose = process.argv[2];

// get environment variables
const blockfrostUrl = getEnv("BLOCKFROST_URL");
const projectId = getEnv("BLOCKFROST_PROJECT_KEY");
const cardanoNetwork = getEnv("PUBLIC_CARDANO_NETWORK");
const walletAddress = getEnv("WALLET_ADDRESS");
const privateKey = getEnv("WALLET_PRIVATE_KEY");

// set up a blockfrost-connected lucid instance
const bf: Blockfrost = new Blockfrost(blockfrostUrl, projectId);
const lucid: LucidEvolution = await Lucid(bf, cardanoNetwork as Network);
lucid.selectWallet.fromPrivateKey(privateKey);

// isolate the contracts' cbor
const type: PlutusVersion = "PlutusV2";
const alwaysFails = (key: string) => {
  return {
    type,
    script: applyParamsToScript(
      contracts.validators.find((v) => v.title === "always_fails.spend")
        ?.compiledCode ?? "",
      [key]
    ),
  };
};

const timelockedMP = {
  type,
  script:
    contracts.validators.find((v) => v.title === "minting.minting_validator")
      ?.compiledCode ?? "",
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
      const validator = alwaysFails(validatorToScriptHash(timelockedMP));
      return await runTx(() =>
        testTimelockedMint(lucid, timelockedMP, validator, walletAddress)
      );
    }
    case "get-royalties":
      return await extractRoyaltyInfo(lucid, process.argv[3]);
    default:
      return { error: "no transaction selected" };
  }
}

/**
 * A simple function to attempt to build a tx, sign it, and submit it to the blockchain
 * @param txBuilder the frontend transaction builder, often just a simple tunnel to the offchain library
 */
async function runTx(txBuilder: () => Promise<TxBuild>) {
  const txBuild = await txBuilder();
  if (!txBuild.tx) {
    return txBuild.error;
  } else {
    console.log(txBuild);
    const signedTx = await txBuild.tx.sign.withPrivateKey().complete();
    const txHash = await signedTx.submit();
    return txHash;
  }
}

/**
 *  Examples of constructing transactions from the frontend using the endpoints defined in this library.
 *   - testTimelockedMint: a collection with CIP 68 NFTs and a CIP 102 royalty
 * */

function testTimelockedMint(
  lucid: LucidEvolution,
  mp: Script,
  validator: Script,
  walletAddress: string
): Promise<TxBuild> {
  // configuration - these would come from user input. Adjust these however you wish.
  const mock_image = "ipfs://QmeTkA5bY4P3DUjhdtPc2MsT8G8keb7HAxjccKrLJN2xTz";
  const mock_name = "test";
  const mock_deadline = new Date("2025-12-21T23:59:59Z").getTime();
  const mock_size = 5;
  const mock_fee = 1.6;

  // parameterize minting policy
  const parameterized_mp = createTimelockedMP(
    lucid,
    mp.script,
    mock_deadline,
    walletAddress
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

  return mintNFTs(lucid, parameterized_mp, validator, assets, royalties[0]);
}
