import {
  fromChainVariableFee,
  toRoyaltyUnit,
  type Royalty,
} from "./common/royalties.js";
import { toBech32Address } from "./common/chain.js";
import { parseDatumCbor } from "@meshsdk/core-cst";
import type { BlockfrostProvider } from "@meshsdk/provider";

export function toRoyaltyInfo(chainInfo: any, networkId: number): Royalty[] {
  // chainInfo = Constr(0, [recipients: Data[], version: bigint, extra: Data])
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

export async function extractRoyaltyInfo(
  provider: BlockfrostProvider,
  policyId: string,
  networkId: number,
) {
  try {
    const unit = toRoyaltyUnit(policyId);
    const assetAddresses = await provider.fetchAssetAddresses(unit);
    if (!assetAddresses.length) return undefined;

    const utxos = await provider.fetchAddressUTxOs(
      assetAddresses[0].address,
      unit,
    );
    if (!utxos.length) return undefined;

    const datumCbor = utxos[0].output.plutusData;
    if (!datumCbor) return undefined;

    const chainInfo = parseDatumCbor<any>(datumCbor);
    return toRoyaltyInfo(chainInfo, networkId);
  } catch (err) {
    console.log("Error getting royalties");
    console.log(err);
  }
  return undefined;
}
