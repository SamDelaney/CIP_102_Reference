use aiken/builtin.{choose_data}
use aiken/bytearray
use aiken/dict.{Dict}
use aiken/hash.{Blake2b_224, Blake2b_256, Hash}
use aiken/int
use aiken/list
use aiken/string
use aiken/transaction.{Datum, DatumHash, InlineDatum, Input, NoDatum}
use aiken/transaction/credential.{Address, VerificationKey}
use aiken/transaction/value.{AssetName, PolicyId}

pub const royalty_tn: ByteArray = "001f4d70526f79616c7479"

// The Data map key used in a CIP-68 reference datum's `extra` field to select
// which postfixed CIP-102 v2 royalty token (if any) applies to a given NFT.
pub const royalty_included_key: ByteArray = "royalty_included"

// taken from the CIP 68 standard
pub const user_tn_prefix: ByteArray = "000de140"

pub const ref_tn_prefix: ByteArray = "000643b0"

pub type RoyaltyDatum {
  recipients: List<RoyaltyRecipient>,
  version: Int,
  extra: Data,
}

pub type Metadata =
  Pairs<ByteArray, Data>

pub type ChooseData {
  DConstr
  DMap
  DList
  DInt
  DByteArray
}

pub type RefDatumMetadata {
  metadata: Metadata,
  version: Int,
  extra: Metadata,
}

pub type RoyaltyRecipient {
  address: Address,
  // percentage (fraction)
  fee: Int,
  // fixed (absolute)
  min_fee: Option<Int>,
  // fixed (absolute)
  max_fee: Option<Int>,
}

pub type Asset {
  policy_id: PolicyId,
  asset_name: AssetName,
  quantity: Int,
}

pub type VerificationKeyHash =
  Hash<Blake2b_224, VerificationKey>

// converts between the encoded onchain fee & per mille to avoid dealing with decimals
// since integer division handles the truncation for us, it's as simple as dividing by 10000
// recall that n / (n / m) == m, so the same function handles both directions of conversion
pub fn to_from_per_mille_fee(in_fee: Int) -> Int {
  10_000 / in_fee
}

// take a CIP 68 user token asset name, and output the corresponding reference token asset name
pub fn get_ref_tn(asset_name: ByteArray) -> ByteArray {
  bytearray.concat(ref_tn_prefix, bytearray.drop(asset_name, 8))
}

// take a CIP 68 reference token asset name, and output the corresponding user token asset name
pub fn get_user_tn(asset_name: ByteArray) -> ByteArray {
  bytearray.concat(user_tn_prefix, bytearray.drop(asset_name, 8))
}

// Constructs a CIP-102 royalty token asset name. `None` yields the v1 base
// `(500)Royalty` token; `Some(postfix)` yields the v2 `(500)Royalty<postfix>`
// token, appending the UTF-8 decimal digits of `postfix`.
pub fn construct_royalty_tn(postfix: Option<Int>) -> ByteArray {
  when postfix is {
    None -> royalty_tn
    Some(p) -> bytearray.concat(royalty_tn, string.to_bytearray(string.from_int(p)))
  }
}

// Reads the `royalty_included` selector out of a CIP-68 reference datum's
// `extra` field. Returns `None` only when the key is *absent* (v1-compatible /
// optional discovery). A key that is present but whose value can't be parsed
// as an integer is malformed and fails closed rather than being silently
// treated as absent, which would bypass v2 enforcement.
pub fn parse_royalty_included(extra: Metadata) -> Option<Int> {
  when list.find(extra, fn(item) { item.1st == royalty_included_key }) is {
    None -> None
    Some(item) ->
      when choose_data(item.2nd, DConstr, DMap, DList, DInt, DByteArray) is {
        DInt -> {
          expect parsed_int: Int = item.2nd
          Some(parsed_int)
        }
        DByteArray -> {
          expect parsed_ba: ByteArray = item.2nd
          expect Some(parsed_int) = int.from_utf8(parsed_ba)
          Some(parsed_int)
        }
        // Present with a non-integer data type: malformed, fail closed.
        _ -> fail
      }
  }
}

pub fn get_data(
  tx_datums: Dict<Hash<Blake2b_256, Data>, Data>,
  datum: Datum,
) -> Data {
  when datum is {
    NoDatum -> fail
    DatumHash(h) -> {
      expect Some(d) = dict.get(tx_datums, h)
      d
    }
    InlineDatum(d) -> d
  }
}

// Finds the reference input holding exactly one of the given royalty token and
// returns its datum's recipients. When `required` is False (v1 base token,
// optional) a missing token yields an empty recipient list; when True (v2
// postfixed token) a missing token fails closed.
fn find_royalty_recipients(
  asset: Asset,
  reference_inputs: List<Input>,
  datums: Dict<Hash<Blake2b_256, Data>, Data>,
  royalty_asset_name: AssetName,
  required: Bool,
) -> List<RoyaltyRecipient> {
  when
    list.find(
      reference_inputs,
      fn(input) {
        value.quantity_of(
          input.output.value,
          asset.policy_id,
          royalty_asset_name,
        ) == 1
      },
    )
  is {
    Some(royalty_input) -> {
      expect royalty_info: RoyaltyDatum =
        get_data(datums, royalty_input.output.datum)
      royalty_info.recipients
    }
    None ->
      if required {
        fail
      } else {
        []
      }
  }
}

pub fn get_recipients(
  asset: Asset,
  reference_inputs: List<Input>,
  datums: Dict<Hash<Blake2b_256, Data>, Data>,
) -> List<RoyaltyRecipient> {
  // For a CIP-68 user token, the NFT's reference datum authoritatively selects
  // which royalty token (if any) applies. This must be consulted *before*
  // choosing a royalty token, so that a v2 selector can't be satisfied by the
  // base (500)Royalty token (and selector = 0 requires no royalty at all).
  if bytearray.take(asset.asset_name, 8) == user_tn_prefix {
    // calculate the reference token asset name and locate its input
    let ref_tn = get_ref_tn(asset.asset_name)
    expect Some(ref_token_input) =
      list.find(
        reference_inputs,
        fn(input) {
          value.quantity_of(input.output.value, asset.policy_id, ref_tn) == 1
        },
      )
    expect reference_datum: RefDatumMetadata =
      get_data(datums, ref_token_input.output.datum)

    // CIP-102 v2: check for a royalty_included selector.
    when parse_royalty_included(reference_datum.extra) is {
      // Field absent: v1-compatible. The base (500)Royalty token is accepted
      // but not required.
      None ->
        find_royalty_recipients(
          asset,
          reference_inputs,
          datums,
          royalty_tn,
          False,
        )
      Some(postfix) ->
        if postfix == 0 {
          // Explicitly no royalty required: don't search for one.
          []
        } else if postfix > 0 {
          // Require exactly the matching postfixed royalty token.
          find_royalty_recipients(
            asset,
            reference_inputs,
            datums,
            construct_royalty_tn(Some(postfix)),
            True,
          )
        } else {
          // Negative / malformed selector: fail safe.
          fail
        }
    }
  } else {
    // Not a CIP-68 user token: single-policy v1 model. The base (500)Royalty
    // token, if present, applies but is not required.
    find_royalty_recipients(asset, reference_inputs, datums, royalty_tn, False)
  }
}

test test_to_per_mille() {
  and {
    to_from_per_mille_fee(125) == 80,
    to_from_per_mille_fee(625) == 16,
  }
}
