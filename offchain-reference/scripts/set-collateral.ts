// Sends a fixed amount of ADA from the wallet to itself, creating a fresh
// pure-ADA UTxO that can be used as collateral for Plutus transactions.
//
// Usage:
//   npm run set-collateral
//   npm run set-collateral -- -- --amount 5

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
import { createInterface } from "node:readline";
// @meshsdk/core-cst bundles its own copy of libsodium-wrappers-sumo. We must
// await *that* instance's .ready — not the top-level copy — otherwise
// Ed25519PrivateKey throws "sodium.crypto_scalarmult_ed25519_base_noclamp is
// not a function" because the nested WASM hasn't finished initializing.
// @ts-ignore – nested package has no .d.ts; types come from @types/libsodium-wrappers-sumo
import internalSodium from "../node_modules/@meshsdk/core-cst/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js";
import { BlockfrostProvider } from "@meshsdk/provider";
import { MeshTxBuilder } from "@meshsdk/transaction";
import {
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

// ── Parse argv ───────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  options: {
    amount: { type: "string" },
  },
});

const COLLATERAL_LOVELACE = BigInt(
  Math.round(
    (values.amount !== undefined ? parseFloat(values.amount) : 5) * 1_000_000,
  ),
);

if (COLLATERAL_LOVELACE < 1_000_000n) {
  console.error("--amount must be at least 1 ADA");
  process.exit(1);
}

// ── Environment ──────────────────────────────────────────────────────────────

const projectId = getEnv("BLOCKFROST_PROJECT_KEY");
const walletAddress = getEnv("WALLET_ADDRESS");
const privateKey = getEnv("WALLET_PRIVATE_KEY");

await internalSodium.ready;

const provider = new BlockfrostProvider(projectId);

// ── Main ─────────────────────────────────────────────────────────────────────

const utxos = await provider.fetchAddressUTxOs(walletAddress);
if (!utxos.length) {
  console.error("Wallet has no UTxOs. Fund it first.");
  process.exit(1);
}

// Check whether a pure-ADA UTxO already exists
const existing = utxos.find(
  (u) =>
    u.output.amount.length === 1 && u.output.amount[0]?.unit === "lovelace",
);
if (existing) {
  const ada = Number(BigInt(existing.output.amount[0]!.quantity)) / 1_000_000;
  console.log(
    `A pure-ADA UTxO already exists (${ada.toFixed(6)} ADA at ${existing.input.txHash}#${existing.input.outputIndex}).`,
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question("Create another one anyway? [y/N] ", (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    }),
  );
  if (answer !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }
}

console.log(
  `Building tx: sending ${Number(COLLATERAL_LOVELACE) / 1_000_000} ADA to self...`,
);

const txBuilder = new MeshTxBuilder({ fetcher: provider, evaluator: provider });

txBuilder
  .txOut(walletAddress, [
    { unit: "lovelace", quantity: COLLATERAL_LOVELACE.toString() },
  ])
  .selectUtxosFrom(utxos)
  .changeAddress(walletAddress);

const unsignedTxHex = await txBuilder.complete();

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise<string>((resolve) =>
  rl.question("Submit transaction? [y/N] ", (a) => {
    rl.close();
    resolve(a.trim().toLowerCase());
  }),
);
if (answer !== "y") {
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

const submittedHash = await provider.submitTx(signedCbor);
console.log(`Submitted! Tx hash: ${submittedHash}`);
console.log(
  "Wait for the transaction to confirm, then run `npm run print-utxos` to verify.",
);
process.exit(0);
