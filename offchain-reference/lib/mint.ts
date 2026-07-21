import type { PlutusScript, Data, IEvaluator, UTxO } from "@meshsdk/common";
import {
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
} from "@meshsdk/common";
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
import cbor from "cbor";

/// Mesh bundles hardcoded default Plutus cost models (used both to compute
/// script_data_hash and internally by MeshTxBuilder.complete()'s own
/// coin-selection cost-estimation evaluate call) that quickly go stale
/// relative to the live network - e.g. the testnet's PlutusV2 model grew
/// from 175 to 332 parameters at epoch 289 (2026-05-16), but Mesh's bundled
/// defaults were never updated. A stale default causes .complete() itself to
/// fail with an opaque "Evaluate redeemers failed" / empty ScriptFailures
/// error, before a transaction is ever built or submitted.
///
/// Fetch the live cost models from Blockfrost once per process and patch
/// Mesh's shared default arrays in place (they're re-exported by reference
/// from @meshsdk/common into @meshsdk/core-cst) so every subsequent
/// evaluate/build call - both Mesh's internal one and ours - uses the
/// correct values.
let costModelsSynced = false;
async function syncLiveCostModels(provider: BlockfrostProvider): Promise<void> {
  if (costModelsSynced) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (provider as any)._axiosInstance.get(
    "epochs/latest/parameters",
  );
  const rawModels = data.cost_models_raw as
    | Record<string, number[] | Record<string, number>>
    | undefined;
  if (!rawModels) return;

  // Only mark as synced once the live models have actually been fetched and
  // patched in. A failed request (transient outage) leaves the flag unset so a
  // later call retries rather than proceeding with stale Mesh defaults.

  const toList = (
    v: number[] | Record<string, number> | undefined,
  ): number[] | undefined => {
    if (!v) return undefined;
    return Array.isArray(v) ? v : Object.values(v);
  };
  const patch = (target: number[], source: number[] | undefined) => {
    if (!source) return;
    target.length = 0;
    target.push(...source);
  };

  patch(DEFAULT_V1_COST_MODEL_LIST, toList(rawModels["PlutusV1"]));
  patch(DEFAULT_V2_COST_MODEL_LIST, toList(rawModels["PlutusV2"]));
  patch(DEFAULT_V3_COST_MODEL_LIST, toList(rawModels["PlutusV3"]));

  costModelsSynced = true;
}

/// cardano-sdk's input-selection library (used internally by
/// MeshTxBuilder.complete()'s coin-selection loop) makes its first
/// fee/ex-units probe by calling the evaluator with a `fee: MAX_U64`
/// placeholder (18446744073709551615n - see
/// @cardano-sdk/input-selection's RoundRobinRandomImprove/index.js). Mesh
/// embeds that placeholder verbatim as the trial tx's `fee` field before
/// asking Blockfrost's real /utils/txs/evaluate endpoint for execution
/// units, so every probe tx claims an ~18-quintillion-ADA fee. At this call
/// site cardano-sdk always computes change assuming fee=0 (inputs ==
/// outputs + change exactly), so replacing the sentinel with 0 keeps the
/// probe tx balanced.
///
/// NB this does not, by itself, fix the opaque
/// "EvaluationFailure":{"ScriptFailures":{}} some mints hit - that turned
/// out to be a separate, still-unresolved issue (reproduces even for a
/// trivially-`True` minting policy, so it isn't validator logic). Fixing
/// this sentinel is still correct: it removes one genuine source of
/// nonsensical probe transactions.
const MAX_U64_FEE_SENTINEL = 18446744073709551615n;

function wrapEvaluatorFixingFeeSentinel(
  provider: BlockfrostProvider,
): IEvaluator {
  return {
    evaluateTx: async (tx) => {
      const decoded = cbor.decodeFirstSync(Buffer.from(tx, "hex"));
      const body = decoded[0] as Map<number, unknown>;
      if (body.get(2) === MAX_U64_FEE_SENTINEL) {
        // A plain number, not 0n: the `cbor` package always encodes BigInt
        // as a tagged bignum, which the ledger's CDDL rejects for `fee`
        // (must be a bare CBOR uint).
        body.set(2, 0);
        tx = (cbor.encode(decoded) as Buffer).toString("hex");
      }
      return provider.evaluateTx(tx);
    },
  };
}

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
  toRoyaltyAssetNameHex,
  toRoyaltyIncludedExtra,
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
 * Create a royalty token with no other assets.
 *
 * `royaltyPostfix`, when provided, mints a CIP-102 v2 postfixed royalty token
 * `(500)Royalty<postfix>` with datum `version = 2`. Omit it to mint the v1
 * base `(500)Royalty` token with `version = 1`.
 */
export async function createRoyalty(
  provider: BlockfrostProvider,
  walletAddress: string,
  policy: PlutusScript,
  validator: PlutusScript,
  royalty: Royalty,
  royaltyPostfix?: number,
): Promise<TxBuild> {
  await syncLiveCostModels(provider);

  const version = royaltyPostfix !== undefined ? 2n : 1n;
  const royaltyDatum = toCip102RoyaltyDatum([royalty], version);
  const royaltyAssetNameHex = toRoyaltyAssetNameHex(royaltyPostfix);

  const validToMs = Date.now() + 3_600_000; // +1 hour
  const validToSlot = await msToSlot(provider, validToMs);

  const utxos = await provider.fetchAddressUTxOs(walletAddress);
  if (!utxos.length) return { error: "empty-wallet" };

  const policyId = resolvePlutusScriptHash(
    resolvePlutusScriptAddress(policy, networkId),
  );
  const royaltyUnit = toRoyaltyUnit(policyId, royaltyPostfix);
  const validatorAddress = resolvePlutusScriptAddress(validator, networkId);
  const paymentKeyHash = resolvePaymentKeyHash(walletAddress);

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: wrapEvaluatorFixingFeeSentinel(provider),
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
    .mintPlutusScriptV3()
    .mint("1", policyId, CIP68_LABEL[500] + royaltyAssetNameHex)
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
 *
 * `royaltyPostfix`, when provided, applies the CIP-102 v2 flow: the minted
 * royalty token (if any) becomes `(500)Royalty<postfix>` with datum
 * `version = 2`, and every minted reference datum's `extra.royalty_included`
 * is set to that postfix. All NFTs minted in this call share the same single
 * postfix; per-NFT policy assignment is a future upgrade (see V2_Checklist.md).
 */
export async function mintNFTs(
  provider: BlockfrostProvider,
  walletAddress: string,
  policy: PlutusScript,
  validator: PlutusScript,
  sanitizedMetadataAssets: MediaAssets,
  cip102?: "NoRoyalty" | "Premade" | Royalty,
  refAddress?: string,
  royaltyPostfix?: number,
): Promise<TxBuild> {
  await syncLiveCostModels(provider);

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

  // extra datum for reference tokens: the CIP-102 `royalty_included` selector.
  //  - "NoRoyalty": explicitly require no royalty input (selector = 0).
  //  - "Premade" or a fresh Royalty, with a postfix: require the postfixed
  //    token (CIP-102 v2, selector = postfix).
  //  - "Premade" or a fresh Royalty, without a postfix: optional base token
  //    lookup (v1-compatible, selector omitted).
  const extra: Data =
    cip102 === "NoRoyalty"
      ? toRoyaltyIncludedExtra(0)
      : toRoyaltyIncludedExtra(royaltyPostfix);

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: wrapEvaluatorFixingFeeSentinel(provider),
  });

  // Mint royalty token if requested
  if (royalty) {
    const version = royaltyPostfix !== undefined ? 2n : 1n;
    const royaltyDatum = toCip102RoyaltyDatum([royalty], version);
    const royaltyUnit = toRoyaltyUnit(policyId, royaltyPostfix);
    const royaltyAssetNameHex = toRoyaltyAssetNameHex(royaltyPostfix);
    txBuilder
      .mintPlutusScriptV3()
      .mint("1", policyId, CIP68_LABEL[500] + royaltyAssetNameHex)
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
      .mintPlutusScriptV3()
      .mint("1", policyId, CIP68_LABEL[100] + tokenNameHex)
      .mintingScript(policy.code)
      .mintRedeemerValue({ alternative: 0, fields: [] }, "Mesh");
    txBuilder
      .txOut(validatorAddress, [{ unit: refUnit, quantity: "1" }])
      .txOutInlineDatumValue(datumToCbor(refDatum), "CBOR");

    // Mint the user token (goes to wallet)
    txBuilder
      .mintPlutusScriptV3()
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
    version: "V3",
    code: applyParamsToScript(mp, [BigInt(timestamp), paymentHash]),
  };
}
