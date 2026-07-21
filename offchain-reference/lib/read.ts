import {
  fromChainVariableFee,
  toRoyaltyUnit,
  toUnit,
  parseRoyaltyIncluded,
  type Royalty,
} from "./common/royalties.js";
import { toBech32Address, toMeshData } from "./common/chain.js";
import { parseDatumCbor } from "@meshsdk/core-cst";
import type { BlockfrostProvider } from "@meshsdk/provider";

export function toRoyaltyInfo(chainInfo: any, networkId: number): Royalty[] {
  // chainInfo = Constr(0, [recipients: Data[], version: bigint, extra: Data])
  // Input must be pre-normalised via toMeshData so fields[0] is a plain array.
  const recipients: any[] = chainInfo.fields[0];
  return recipients.map((recipient: any) => {
    const addressData = recipient.fields[0];
    const fee = recipient.fields[1] as bigint;
    const minFeeOption = recipient.fields[2] as {
      alternative: number;
      fields: any[];
    };
    const maxFeeOption = recipient.fields[3] as {
      alternative: number;
      fields: any[];
    };

    return {
      address: toBech32Address(addressData),
      fee: fromChainVariableFee(fee),
      minFee:
        minFeeOption.alternative === 0
          ? Number(minFeeOption.fields[0])
          : undefined,
      maxFee:
        maxFeeOption.alternative === 0
          ? Number(maxFeeOption.fields[0])
          : undefined,
    };
  });
}

/// Fetches and parses the royalty datum for a single royalty token unit, or
/// `undefined` if no such token/UTxO/datum can be found.
async function fetchRoyaltyInfoForUnit(
  provider: BlockfrostProvider,
  unit: string,
  networkId: number,
): Promise<Royalty[] | undefined> {
  const assetAddresses = await provider.fetchAssetAddresses(unit);
  if (!assetAddresses.length) return undefined;

  const utxos = await provider.fetchAddressUTxOs(
    assetAddresses[0].address,
    unit,
  );
  if (!utxos.length) return undefined;

  const datumCbor = utxos[0].output.plutusData;
  if (!datumCbor) return undefined;

  const chainInfo: any = toMeshData(parseDatumCbor<any>(datumCbor));
  return toRoyaltyInfo(chainInfo, networkId);
}

/// Queries the royalty information for a policy's royalty token.
///
/// Omit `postfix` for the v1-compatible base `(500)Royalty` token. Pass an
/// explicit `postfix` to look up a specific CIP-102 v2 `(500)Royalty<postfix>`
/// token unambiguously. This does not consult any reference datum; use
/// `extractRoyaltyInfoForAsset` to resolve the postfix for a specific NFT.
export async function extractRoyaltyInfo(
  provider: BlockfrostProvider,
  policyId: string,
  networkId: number,
  postfix?: number,
) {
  try {
    const unit = toRoyaltyUnit(policyId, postfix);
    return await fetchRoyaltyInfoForUnit(provider, unit, networkId);
  } catch (err) {
    console.log("Error getting royalties");
    console.log(err);
  }
  return undefined;
}

/// Resolves and queries the royalty information for a specific CIP-68 NFT,
/// following the CIP-102 discovery algorithm:
///   1. Fetch the NFT's (100) reference token datum.
///   2. Read the `royalty_included` selector from its `extra` field.
///   3. `royalty_included > 0`  -> require & query `(500)Royalty<selector>`.
///      `royalty_included === 0` -> no royalty required; returns `undefined`.
///      absent                   -> v1-compatible optional lookup of the base
///                                  `(500)Royalty` token.
///
/// `assetNameHex` is the hex-encoded token payload without any CIP-68 label
/// prefix (e.g. `utf8ToHex("myNFT0")`), matching the value used when minting.
export async function extractRoyaltyInfoForAsset(
  provider: BlockfrostProvider,
  policyId: string,
  assetNameHex: string,
  networkId: number,
): Promise<Royalty[] | undefined> {
  try {
    const refUnit = toUnit(policyId, assetNameHex, 100);
    const assetAddresses = await provider.fetchAssetAddresses(refUnit);
    if (!assetAddresses.length) return undefined;

    const utxos = await provider.fetchAddressUTxOs(
      assetAddresses[0].address,
      refUnit,
    );
    if (!utxos.length) return undefined;

    const datumCbor = utxos[0].output.plutusData;
    if (!datumCbor) return undefined;

    // RefDatumMetadata = Constr(0, [metadata, version, extra])
    const refDatum: any = toMeshData(parseDatumCbor<any>(datumCbor));
    const extra = refDatum.fields[2];
    const postfix = parseRoyaltyIncluded(extra);

    if (postfix === 0) return undefined;
    return await extractRoyaltyInfo(provider, policyId, networkId, postfix);
  } catch (err) {
    console.log("Error getting royalties for asset");
    console.log(err);
  }
  return undefined;
}
