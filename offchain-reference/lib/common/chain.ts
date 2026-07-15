import type { Data } from "@meshsdk/common";
import { addrBech32ToPlutusDataObj, serializeAddress } from "@meshsdk/core-cst";
import { getEnv } from "../../scripts/env.js";

const cardanoNetwork = getEnv("PUBLIC_CARDANO_NETWORK");
const networkId = cardanoNetwork === "mainnet" ? 1 : 0;

// NFT datum metadata types (plain TypeScript - no schema DSL needed for MeshJS)
export type NFTMetadata = Map<Data, Data>;
export type NFTDatumMetadata = {
  metadata: NFTMetadata;
  version: bigint;
  extra: Data;
};

// Aiken Address representation as Mesh Data (Constr(0, [payment_cred, stake_option]))
export type ChainAddress = Data;

/// Converts a Aiken chain address Data object back to a bech32 address.
/// addressData is the parsed Plutus data representation of Cardano's Address type:
///   Constr(0, [Credential, Option<StakeCredential>])
/// where Credential = Constr(0, [keyHash]) | Constr(1, [scriptHash])
/// and   Option     = Constr(1, [])         | Constr(0, [StakeCredential])
/// and   StakeCredential = Constr(0, [Credential]) for Inline
export function toBech32Address(addressData: Data): string {
  const addr = addressData as { alternative: number; fields: Data[] };
  const paymentCred = addr.fields[0] as { alternative: number; fields: Data[] };
  const stakeOption = addr.fields[1] as { alternative: number; fields: Data[] };

  const isScript = paymentCred.alternative === 1;
  const paymentHash = paymentCred.fields[0] as string;

  let stakeCredentialHash: string | undefined;
  let stakeScriptCredentialHash: string | undefined;

  if (stakeOption.alternative === 0) {
    // Some(StakeCredential): Constr(0, [Constr(type, [hash])])
    const stakeCred = stakeOption.fields[0] as {
      alternative: number;
      fields: Data[];
    };
    // stakeCred = Constr(0, [hash]) for VKey, Constr(1, [hash]) for Script
    if (stakeCred.alternative === 0) {
      stakeCredentialHash = stakeCred.fields[0] as string;
    } else {
      stakeScriptCredentialHash = stakeCred.fields[0] as string;
    }
  }

  return serializeAddress(
    {
      pubKeyHash: isScript ? undefined : paymentHash,
      scriptHash: isScript ? paymentHash : undefined,
      stakeCredentialHash,
      stakeScriptCredentialHash,
    } as any,
    networkId,
  );
}

/// Converts a bech32 address to the Aiken chain address Data representation
export function asChainAddress(address: string): ChainAddress {
  // addrBech32ToPlutusDataObj uses { constructor, fields } but MeshJS requires
  // { alternative, fields }. Recursively rename the key.
  const raw = addrBech32ToPlutusDataObj<any>(address);
  return toMeshData(raw);
}

export function toMeshData(data: any): Data {
  if (typeof data !== "object" || data === null) return data as Data;
  if (Array.isArray(data)) return data.map(toMeshData) as Data;
  if (data instanceof Map) {
    const m = new Map<Data, Data>();
    for (const [k, v] of data.entries()) m.set(toMeshData(k), toMeshData(v));
    return m as Data;
  }
  // { bytes: "hex" } → plain hex string (MeshJS represents bytes as hex strings)
  if (Object.prototype.hasOwnProperty.call(data, "bytes")) {
    return data.bytes as string;
  }
  // { int: BigInt } → BigInt (parseDatumCbor wraps integers this way)
  if (Object.prototype.hasOwnProperty.call(data, "int")) {
    return BigInt(data.int) as unknown as Data;
  }
  // { list: [...] } → plain JS array (parseDatumCbor uses this for CBOR lists)
  if (Object.prototype.hasOwnProperty.call(data, "list")) {
    return (data.list as any[]).map(toMeshData) as Data;
  }
  // { map: [{k,v}] } → JS Map (parseDatumCbor uses this for CBOR maps)
  if (Object.prototype.hasOwnProperty.call(data, "map")) {
    const m = new Map<Data, Data>();
    for (const { k, v } of data.map as { k: any; v: any }[]) {
      m.set(toMeshData(k), toMeshData(v));
    }
    return m as Data;
  }
  if (Object.prototype.hasOwnProperty.call(data, "constructor")) {
    return {
      // getAlternative() returns a BigInt; convert to number for comparison
      alternative: Number(data.constructor),
      fields: (data.fields as any[]).map(toMeshData),
    } as Data;
  }
  return data as Data;
}

// based on Blockfrost's openAPI
export type asset_transactions = Array<{
  /**
   * Hash of the transaction
   */
  tx_hash: string;
  /**
   * Transaction index within the block
   */
  tx_index: number;
  /**
   * Block height
   */
  block_height: number;
  /**
   * Block creation time in UNIX time
   */
  block_time: number;
}>;

export type output = {
  /**
   * Output address
   */
  address: string;
  amount: Array<{
    /**
     * The unit of the value
     */
    unit: string;
    /**
     * The quantity of the unit
     */
    quantity: string;
  }>;
  /**
   * UTXO index in the transaction
   */
  output_index: number;
  /**
   * The hash of the transaction output datum
   */
  data_hash: string | null;
  /**
   * CBOR encoded inline datum
   */
  inline_datum: string | null;
  /**
   * Whether the output is a collateral output
   */
  collateral: boolean;
  /**
   * The hash of the reference script of the output
   */
  reference_script_hash: string | null;
};
