import {
  fromChainVariableFee,
  toRoyaltyUnit,
  type Royalty,
  type RoyaltyInfoType,
  RoyaltyInfoShape,
} from "./common/royalties.js";
import { toBech32Address } from "./common/chain.js";
import { Data, LucidEvolution } from "@lucid-evolution/lucid";

export function toRoyaltyInfo(
  lucid: LucidEvolution,
  chainInfo: RoyaltyInfoType
): Royalty[] {
  const { metadata } = chainInfo;
  let royalties: Royalty[] = [];
  metadata.forEach((royalty) => {
    royalties.push({
      address: toBech32Address(lucid, royalty.address),
      fee: fromChainVariableFee(royalty.fee),
      minFee: royalty.minFee ? Number(royalty.minFee) : undefined,
      maxFee: royalty.maxFee ? Number(royalty.maxFee) : undefined,
    });
  });

  return royalties;
}

export async function extractRoyaltyInfo(
  lucid: LucidEvolution,
  policy: string
) {
  try {
    const utxo = await lucid.utxoByUnit(toRoyaltyUnit(policy));
    if (utxo) {
      const datum = await lucid.datumOf(utxo);
      const chainInfo = Data.castFrom(datum, RoyaltyInfoShape);
      return toRoyaltyInfo(lucid, chainInfo);
    } else return undefined;
  } catch (err) {
    console.log("Error getting royalties");
    console.log(err);
  }
  return undefined;
}
