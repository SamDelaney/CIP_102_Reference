import { utf8ToHex } from "@meshsdk/core-cst";
import {
  CIP68_LABEL,
  ROYALTY_TOKEN_LABEL,
  ROYALTY_TOKEN_NAME,
  ROYALTY_INCLUDED_KEY,
  toRoyaltyAssetNameHex,
  toRoyaltyUnit,
  toRoyaltyIncludedExtra,
  parseRoyaltyIncluded,
  toCip102RoyaltyDatum,
} from "./royalties.js";
import type { Data } from "@meshsdk/common";

const POLICY = "a".repeat(56);
const LABEL_500 = CIP68_LABEL[ROYALTY_TOKEN_LABEL];

describe("toRoyaltyAssetNameHex", () => {
  it("returns the bare base asset name when no postfix is given", () => {
    expect(toRoyaltyAssetNameHex()).toBe(ROYALTY_TOKEN_NAME);
  });

  it("appends the UTF-8 digits of a single-digit postfix", () => {
    expect(toRoyaltyAssetNameHex(2)).toBe(ROYALTY_TOKEN_NAME + utf8ToHex("2"));
  });

  it("appends the UTF-8 digits of a multi-digit postfix", () => {
    // (500)Royalty10 — the digits "10" are two separate UTF-8 bytes 0x31 0x30,
    // not a single byte 0x0a.
    expect(toRoyaltyAssetNameHex(10)).toBe(ROYALTY_TOKEN_NAME + "3130");
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects the non-positive-integer postfix %p",
    (bad) => {
      expect(() => toRoyaltyAssetNameHex(bad)).toThrow();
    },
  );
});

describe("toRoyaltyUnit", () => {
  it("builds the v1 base unit when no postfix is given", () => {
    expect(toRoyaltyUnit(POLICY)).toBe(POLICY + LABEL_500 + ROYALTY_TOKEN_NAME);
  });

  it("builds the v2 postfixed unit", () => {
    expect(toRoyaltyUnit(POLICY, 10)).toBe(
      POLICY + LABEL_500 + ROYALTY_TOKEN_NAME + "3130",
    );
  });
});

describe("toRoyaltyIncludedExtra", () => {
  it("returns an empty map for the v1 path (selector absent)", () => {
    const extra = toRoyaltyIncludedExtra() as unknown as Map<Data, Data>;
    expect(extra instanceof Map).toBe(true);
    expect(extra.size).toBe(0);
  });

  it("encodes an explicit 0 as royalty_included = 0", () => {
    const extra = toRoyaltyIncludedExtra(0) as unknown as Map<Data, Data>;
    expect(extra.get(ROYALTY_INCLUDED_KEY)).toBe(0n);
  });

  it("encodes a positive postfix as a bigint", () => {
    const extra = toRoyaltyIncludedExtra(2) as unknown as Map<Data, Data>;
    expect(extra.get(ROYALTY_INCLUDED_KEY)).toBe(2n);
  });

  it.each([-1, 1.5])("rejects the invalid selector %p", (bad) => {
    expect(() => toRoyaltyIncludedExtra(bad)).toThrow();
  });
});

describe("parseRoyaltyIncluded", () => {
  it("round-trips an absent selector to undefined", () => {
    const extra = toRoyaltyIncludedExtra();
    expect(parseRoyaltyIncluded(extra)).toBeUndefined();
  });

  it("round-trips an explicit 0", () => {
    const extra = toRoyaltyIncludedExtra(0);
    expect(parseRoyaltyIncluded(extra)).toBe(0);
  });

  it("round-trips a positive postfix", () => {
    const extra = toRoyaltyIncludedExtra(7);
    expect(parseRoyaltyIncluded(extra)).toBe(7);
  });

  it("returns undefined for a non-map extra", () => {
    expect(parseRoyaltyIncluded("" as unknown as Data)).toBeUndefined();
  });

  it("throws rather than silently losing precision above MAX_SAFE_INTEGER", () => {
    const extra = new Map<Data, Data>();
    extra.set(ROYALTY_INCLUDED_KEY, BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    expect(() => parseRoyaltyIncluded(extra as unknown as Data)).toThrow();
  });
});

describe("toCip102RoyaltyDatum", () => {
  // Uses an empty recipient list so the datum shape/version can be asserted
  // without needing on-chain address serialization.
  it("defaults the base token to datum version 1", () => {
    const datum = toCip102RoyaltyDatum([]) as {
      alternative: number;
      fields: Data[];
    };
    expect(datum.fields[1]).toBe(1n);
  });

  it("uses datum version 2 for a postfixed token", () => {
    const datum = toCip102RoyaltyDatum([], 2n) as {
      alternative: number;
      fields: Data[];
    };
    expect(datum.fields[1]).toBe(2n);
  });
});
