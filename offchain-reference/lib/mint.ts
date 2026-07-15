import type { PlutusScript, Data, UTxO } from "@meshsdk/common";
import type { BlockfrostProvider } from "@meshsdk/provider";
import { MeshTxBuilder } from "@meshsdk/transaction";
import {
  applyParamsToScript,
  resolvePaymentKeyHash,
  resolvePlutusScriptAddress,
  resolvePlutusScriptHash,
  utf8ToHex,
  toPlutusData,
} from "@meshsdk/core-cst";

/// Serialise a Mesh Data value to CBOR hex.
/// MeshTxBuilder.calculateMinLovelaceForOutput uses JSON.parse/stringify
/// internally (cloneOutput) which destroys JavaScript Map objects.
/// Passing datums as CBOR hex strings avoids this problem.
function datumToCbor(datum: Data): string {
  return toPlutusData(datum).toCbor().toString();
}

/// Pick the best collateral UTxO: a pure-ADA UTxO only.
/// Returns undefined if none is available — callers must handle this.
function pickCollateral(utxos: UTxO[]): UTxO | undefined {
  return utxos.find(
    (u) =>
      u.output.amount.length === 1 && u.output.amount[0]?.unit === "lovelace",
  );
}

import {
  toCip102RoyaltyDatum,
  Royalty,
  toRoyaltyUnit,
  toUnit,
  CIP68_LABEL,
} from "./common/royalties.js";

import type { MediaAssets, TxBuild } from "./common/utility.js";
import { getEnv } from "../scripts/env.js";

const cardanoNetwork = getEnv("PUBLIC_CARDANO_NETWORK");
const networkId = cardanoNetwork === "mainnet" ? 1 : 0;

/**
 * Included in this file:
 *  - createRoyalty() - creates a royalty token with no other assets
 *  - mintNFTs() - mints CIP-68 nfts, may include a royalty token in the transaction as well
 *  - createTimelockedMP() - utility to create a parameterized minting policy
 */

/// Convert a MediaAsset JS object into a CIP-68 metadata Map<Data, Data>
function metadataToMap(obj: Record<string, unknown>): Map<Data, Data> {
  const entries = Object.entries(obj).map(([k, v]) => {
    const key: Data = utf8ToHex(k);
    let val: Data;
    if (typeof v === "string") {
      val = utf8ToHex(v);
    } else if (typeof v === "number" || typeof v === "bigint") {
      val = BigInt(v);
    } else if (Array.isArray(v)) {
      val = v.map((item) =>
        typeof item === "string" ? utf8ToHex(item) : (item as Data),
      );
    } else {
      val = utf8ToHex(String(v));
    }
    return [key, val] as [Data, Data];
  });
  return new Map<Data, Data>(entries);
}

/// Compute a slot approximately deadline_ms from now using the current chain tip
async function msToSlot(
  provider: BlockfrostProvider,
  deadlineMs: number,
): Promise<number> {
  const block = await provider.fetchLatestBlock();
  const currentSlot = parseInt(block.slot, 10);
  const deltaSeconds = Math.ceil((deadlineMs - Date.now()) / 1000);
  return currentSlot + deltaSeconds;
}

/**
 * Create a royalty token with no other assets
 */
export async function createRoyalty(
  provider: BlockfrostProvider,
  walletAddress: string,
  policy: PlutusScript,
  validator: PlutusScript,
  royalty: Royalty,
): Promise<TxBuild> {
  const royaltyDatum = toCip102RoyaltyDatum([royalty]);

  const validToMs = Date.now() + 3_600_000; // +1 hour
  const validToSlot = await msToSlot(provider, validToMs);

  const utxos = await provider.fetchAddressUTxOs(walletAddress);
  if (!utxos.length) return { error: "empty-wallet" };

  const policyId = resolvePlutusScriptHash(
    resolvePlutusScriptAddress(policy, networkId),
  );
  const royaltyUnit = toRoyaltyUnit(policyId);
  const validatorAddress = resolvePlutusScriptAddress(validator, networkId);
  const paymentKeyHash = resolvePaymentKeyHash(walletAddress);

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: provider,
  });

  const col = pickCollateral(utxos);
  if (!col) {
    return {
      error:
        "no-pure-ada-collateral: wallet has no UTxO containing only ADA. " +
        "Send a small amount of ADA to your wallet address to create a pure-ADA UTxO for use as collateral. (try npm run set-collateral)",
    };
  }

  // Exclude collateral from coin selection so it isn't spent as a regular input.
  const spendableUtxos = utxos.filter(
    (u) =>
      u.input.txHash !== col.input.txHash ||
      u.input.outputIndex !== col.input.outputIndex,
  );

  txBuilder
    .mintPlutusScriptV2()
    .mint("1", policyId, CIP68_LABEL[500] + utf8ToHex("Royalty"))
    .mintingScript(policy.code)
    .mintRedeemerValue({ alternative: 0, fields: [] }, "Mesh")
    .txOut(validatorAddress, [{ unit: royaltyUnit, quantity: "1" }])
    .txOutInlineDatumValue(datumToCbor(royaltyDatum), "CBOR")
    .requiredSignerHash(paymentKeyHash)
    .invalidHereafter(validToSlot)
    .selectUtxosFrom(spendableUtxos)
    .changeAddress(walletAddress);

  txBuilder.txInCollateral(
    col.input.txHash,
    col.input.outputIndex,
    col.output.amount,
    col.output.address,
  );

  return { tx: txBuilder, policyId };
}

/**
 * Mints CIP-68 nfts as specified in the sanitizedMetadataAssets parameter.
 */
export async function mintNFTs(
  provider: BlockfrostProvider,
  walletAddress: string,
  policy: PlutusScript,
  validator: PlutusScript,
  sanitizedMetadataAssets: MediaAssets,
  cip102?: "NoRoyalty" | "Premade" | Royalty,
  refAddress?: string,
): Promise<TxBuild> {
  const royalty =
    cip102 === "NoRoyalty" || cip102 === "Premade" ? undefined : cip102;

  const utxos = await provider.fetchAddressUTxOs(walletAddress);
  if (!utxos.length) return { error: "empty-wallet" };

  const col = pickCollateral(utxos);
  if (!col) {
    return {
      error:
        "no-pure-ada-collateral: wallet has no UTxO containing only ADA. " +
        "Send a small amount of ADA to your wallet address to create a pure-ADA UTxO for use as collateral. (try npm run set-collateral)",
    };
  }

  // Exclude collateral from coin selection so it isn't spent as a regular input.
  const spendableUtxos = utxos.filter(
    (u) =>
      u.input.txHash !== col.input.txHash ||
      u.input.outputIndex !== col.input.outputIndex,
  );

  const validToMs = Date.now() + 3_600_000; // +1 hour
  const validToSlot = await msToSlot(provider, validToMs);

  const policyId = resolvePlutusScriptHash(
    resolvePlutusScriptAddress(policy, networkId),
  );
  const validatorAddress =
    refAddress ?? resolvePlutusScriptAddress(validator, networkId);
  const paymentKeyHash = resolvePaymentKeyHash(walletAddress);
  const tokenNames = Object.keys(sanitizedMetadataAssets);
  const has102Royalty = cip102 === "Premade" || royalty !== undefined;

  // extra datum for reference tokens: royalty flag or void
  // RoyaltyFlag = Constr(0, [1n]) when royalty attached; Constr(0, []) (void) otherwise
  const extra: Data = has102Royalty
    ? { alternative: 0, fields: [1n] }
    : { alternative: 0, fields: [] };

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: provider,
  });

  // Mint royalty token if requested
  if (royalty) {
    const royaltyDatum = toCip102RoyaltyDatum([royalty]);
    const royaltyUnit = toRoyaltyUnit(policyId);
    txBuilder
      .mintPlutusScriptV2()
      .mint("1", policyId, CIP68_LABEL[500] + utf8ToHex("Royalty"))
      .mintingScript(policy.code)
      .mintRedeemerValue({ alternative: 0, fields: [] }, "Mesh")
      .txOut(validatorAddress, [{ unit: royaltyUnit, quantity: "1" }])
      .txOutInlineDatumValue(datumToCbor(royaltyDatum), "CBOR");
  }

  // Mint each NFT: reference token (100) + user token (222)
  for (const tokenName of tokenNames) {
    const tokenNameHex = utf8ToHex(tokenName);
    const refUnit = toUnit(policyId, tokenNameHex, 100);
    const userUnit = toUnit(policyId, tokenNameHex, 222);

    // Reference token with CIP-68 inline datum
    const metadataMap = metadataToMap(
      sanitizedMetadataAssets[tokenName] as Record<string, unknown>,
    );
    const refDatum: Data = {
      alternative: 0,
      fields: [metadataMap, 1n, extra],
    };

    // Mint the reference token (goes to validator with datum)
    txBuilder
      .mintPlutusScriptV2()
      .mint("1", policyId, CIP68_LABEL[100] + tokenNameHex)
      .mintingScript(policy.code)
      .mintRedeemerValue({ alternative: 0, fields: [] }, "Mesh");
    txBuilder
      .txOut(validatorAddress, [{ unit: refUnit, quantity: "1" }])
      .txOutInlineDatumValue(datumToCbor(refDatum), "CBOR");

    // Mint the user token (goes to wallet)
    txBuilder
      .mintPlutusScriptV2()
      .mint("1", policyId, CIP68_LABEL[222] + tokenNameHex)
      .mintingScript(policy.code)
      .mintRedeemerValue({ alternative: 0, fields: [] }, "Mesh")
      .txOut(walletAddress, [{ unit: userUnit, quantity: "1" }]);
  }

  txBuilder
    .requiredSignerHash(paymentKeyHash)
    .invalidHereafter(validToSlot)
    .selectUtxosFrom(spendableUtxos)
    .changeAddress(walletAddress);

  txBuilder.txInCollateral(
    col.input.txHash,
    col.input.outputIndex,
    col.output.amount,
    col.output.address,
  );

  console.log("walletAddress: ", walletAddress);
  return { tx: txBuilder, policyId };
}

/**
 * Parameterize the timelocked minting policy with your wallet address & minting deadline
 */
export function createTimelockedMP(
  mp: string,
  timestamp: number,
  walletAddress: string,
): PlutusScript {
  if (timestamp <= Date.now())
    throw new Error(
      `Minting deadline has already passed: ${new Date(timestamp).toISOString()}`,
    );

  const paymentHash = resolvePaymentKeyHash(walletAddress);
  if (!paymentHash) throw new Error("Payment hash not found");

  return {
    version: "V2",
    code: applyParamsToScript(mp, [BigInt(timestamp), paymentHash]),
  };
}
