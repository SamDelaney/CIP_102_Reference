import type { Data } from "@meshsdk/common";
import { utf8ToHex } from "@meshsdk/core-cst";
import { asChainAddress } from "./chain.js";

export type Royalty = {
  address: string;
  fee: number; // in percentage
  maxFee?: number;
  minFee?: number;
};

// CIP-68 label prefixes (4-byte hex)
export const CIP68_LABEL: Record<number, string> = {
  100: "000643b0", // reference token
  222: "000de140", // user/NFT token
  500: "001f4d70", // royalty token
};

export const ROYALTY_TOKEN_LABEL = 500;
export const ROYALTY_TOKEN_NAME = utf8ToHex("Royalty");

/// The Data map key used in a CIP-68 reference datum's `extra` field to select
/// which postfixed CIP-102 v2 royalty token (if any) applies to that NFT.
export const ROYALTY_INCLUDED_KEY: string = utf8ToHex("royalty_included");

/// Validates a CIP-102 v2 royalty token postfix. Postfixes must be positive
/// integers (0 is reserved for the `royalty_included` "no royalty" flag, not
/// for a token name).
function assertValidPostfix(postfix: number): void {
  if (!Number.isInteger(postfix) || postfix <= 0) {
    throw new Error(
      `Royalty postfix must be a positive integer, got ${postfix}`,
    );
  }
}

/// Returns the hex-encoded royalty token asset name: hex("Royalty") optionally
/// followed by the UTF-8 decimal digits of a postfix (CIP-102 v2).
export function toRoyaltyAssetNameHex(postfix?: number): string {
  if (postfix === undefined) return ROYALTY_TOKEN_NAME;
  assertValidPostfix(postfix);
  return ROYALTY_TOKEN_NAME + utf8ToHex(String(postfix));
}

/// Returns the asset unit for the royalty token: policyId + label500_prefix + hex("Royalty"[postfix])
/// Omit `postfix` for the v1 base `(500)Royalty` token.
export function toRoyaltyUnit(policyId: string, postfix?: number): string {
  return (
    policyId + CIP68_LABEL[ROYALTY_TOKEN_LABEL] + toRoyaltyAssetNameHex(postfix)
  );
}

/// Builds the reference datum `extra` field value used to select a CIP-102 v2
/// royalty policy for a single NFT.
///  - `postfix` omitted  -> empty map (no `royalty_included` key): v1-compatible,
///    optional discovery of the base `(500)Royalty` token.
///  - `postfix` === 0    -> explicit "no royalty required" (validators must not
///    search for a royalty input).
///  - `postfix` > 0      -> require the matching `(500)Royalty<postfix>` token.
export function toRoyaltyIncludedExtra(postfix?: number): Data {
  const m = new Map<Data, Data>();
  if (postfix !== undefined) {
    if (!Number.isInteger(postfix) || postfix < 0) {
      throw new Error(
        `royalty_included must be a non-negative integer, got ${postfix}`,
      );
    }
    m.set(ROYALTY_INCLUDED_KEY, BigInt(postfix));
  }
  return m as unknown as Data;
}

/// Reads the `royalty_included` selector back out of a parsed reference datum
/// `extra` field (as normalised by `toMeshData`). Returns `undefined` when the
/// key is absent (v1-compatible / optional).
export function parseRoyaltyIncluded(extra: Data): number | undefined {
  if (!(extra instanceof Map)) return undefined;
  const value = (extra as Map<Data, Data>).get(ROYALTY_INCLUDED_KEY);
  if (value === undefined) return undefined;
  const included = value as bigint;
  // Guard against silently losing precision when narrowing to a JS number,
  // which would otherwise resolve to the wrong `(500)Royalty<n>` token.
  if (
    included > BigInt(Number.MAX_SAFE_INTEGER) ||
    included < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new Error(
      `royalty_included ${included} is outside the safe integer range`,
    );
  }
  return Number(included);
}

/// Returns an asset unit for a CIP-68 token
export function toUnit(
  policyId: string,
  nameHex: string,
  label?: number,
): string {
  const prefix = label !== undefined ? (CIP68_LABEL[label] ?? "") : "";
  return policyId + prefix + nameHex;
}

/// Wraps a Data value in Option::Some (Constr(0, [value]))
function some(value: Data): Data {
  return { alternative: 0, fields: [value] };
}

/// Option::None (Constr(1, []))
const none: Data = { alternative: 1, fields: [] };

/// Converts a percentage between 0 and 100 inclusive to the CIP-102 fee format
export function asChainVariableFee(percent: number): bigint {
  if (percent < 0.1 || percent > 100) {
    throw new Error("Royalty fee must be between 0.1 and 100 percent");
  }
  return BigInt(Math.floor(1 / (percent / 1000)));
}

/// Converts from a on chain royalty to a percent between 0 and 100
export function fromChainVariableFee(fee: bigint): number {
  return Math.ceil(Number(10000n / fee)) / 10;
}

/// Confirms the fee is a positive integer and returns as bigint option, or null
export function asChainFixedFee(fee?: number): bigint | null {
  if (fee !== undefined && fee !== null) {
    if (fee < 0 || !Number.isInteger(fee)) {
      throw new Error("Fixed fee must be a positive integer or 0");
    }
    return BigInt(fee);
  }
  return null;
}

/// Converts the offchain royalty list into the Mesh Data object for CIP-102 on-chain datum.
/// Returns a Mesh Data object ready to pass to txOutInlineDatumValue(..., "Mesh").
///
/// `version` should be `1n` (default) for a single base `(500)Royalty` token,
/// or `2n` when the royalty token carries a CIP-102 v2 postfix.
export function toCip102RoyaltyDatum(
  royalties: Royalty[],
  version: bigint = 1n,
): Data {
  const recipients: Data[] = royalties.map((royalty) => {
    const address = asChainAddress(royalty.address);
    const fee = asChainVariableFee(royalty.fee);
    const minFee = asChainFixedFee(royalty.minFee);
    const maxFee = asChainFixedFee(royalty.maxFee);

    // RoyaltyRecipient = Constr(0, [address, fee, Option<minFee>, Option<maxFee>])
    return {
      alternative: 0,
      fields: [
        address,
        fee,
        minFee !== null ? some(minFee) : none,
        maxFee !== null ? some(maxFee) : none,
      ],
    };
  });

  // RoyaltyDatum = Constr(0, [recipients_list, version, extra_bytes])
  return {
    alternative: 0,
    fields: [recipients, version, ""],
  };
}
