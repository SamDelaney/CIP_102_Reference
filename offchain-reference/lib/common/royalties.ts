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

/// Returns the asset unit for the royalty token: policyId + label500_prefix + hex("Royalty")
export function toRoyaltyUnit(policyId: string): string {
  return policyId + CIP68_LABEL[ROYALTY_TOKEN_LABEL] + ROYALTY_TOKEN_NAME;
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
export function toCip102RoyaltyDatum(royalties: Royalty[]): Data {
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
    fields: [recipients, 1n, ""],
  };
}
