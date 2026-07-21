use aiken/bytearray
use aiken/string
use aiken/transaction.{InlineDatum, Input, Output, OutputReference}
use aiken/transaction/credential.{
  Address, ScriptCredential, VerificationKeyCredential,
}
use aiken/transaction/value.{AssetName, PolicyId}
use onchain_reference/common.{
  Metadata, RefDatumMetadata, RoyaltyDatum, RoyaltyRecipient,
  VerificationKeyHash, get_ref_tn, royalty_included_key, royalty_tn,
  to_from_per_mille_fee, user_tn_prefix,
}
use onchain_reference/listing_utils.{Payout}

pub fn placeholder_oref() {
  OutputReference {
    transaction_id: transaction.placeholder().id,
    output_index: 0,
  }
}

// takes per mille fee & recipient vkc and outputs recipient
pub fn placeholder_recipient(
  fee_pml: Int,
  address_vkh: VerificationKeyHash,
) -> RoyaltyRecipient {
  RoyaltyRecipient {
    address: Address {
      payment_credential: VerificationKeyCredential(address_vkh),
      stake_credential: None,
    },
    fee: to_from_per_mille_fee(fee_pml),
    min_fee: None,
    max_fee: None,
  }
}

// Reconstruct an input from a list of RoyaltyRecipients
pub fn recipients_to_input(
  recipients: List<RoyaltyRecipient>,
  policy_id: PolicyId,
) -> Input {
  Input {
    output_reference: placeholder_oref(),
    output: recipients_to_output(recipients, policy_id),
  }
}

// Reconstruct an output from a list of RoyaltyRecipients
pub fn recipients_to_output(
  recipients: List<RoyaltyRecipient>,
  policy_id: PolicyId,
) -> Output {
  let out_royalty_info = RoyaltyDatum { recipients, version: 1, extra: None }

  Output {
    address: Address {
      payment_credential: VerificationKeyCredential(""),
      stake_credential: None,
    },
    value: value.from_asset(policy_id, royalty_tn, 1),
    datum: InlineDatum(out_royalty_info),
    reference_script: None,
  }
}

// CIP-102 v2: reconstruct a royalty Input/Output using an explicit asset name
// (e.g. a postfixed `(500)Royalty<n>` token) and datum version.
pub fn recipients_to_input_named(
  recipients: List<RoyaltyRecipient>,
  policy_id: PolicyId,
  token_name: ByteArray,
  version: Int,
) -> Input {
  Input {
    output_reference: placeholder_oref(),
    output: recipients_to_output_named(recipients, policy_id, token_name, version),
  }
}

pub fn recipients_to_output_named(
  recipients: List<RoyaltyRecipient>,
  policy_id: PolicyId,
  token_name: ByteArray,
  version: Int,
) -> Output {
  let out_royalty_info = RoyaltyDatum { recipients, version, extra: None }

  Output {
    address: Address {
      payment_credential: VerificationKeyCredential(""),
      stake_credential: None,
    },
    value: value.from_asset(policy_id, token_name, 1),
    datum: InlineDatum(out_royalty_info),
    reference_script: None,
  }
}

// CIP-102 v2: build a CIP-68 (100) reference-token Input carrying a
// `royalty_included` selector in its `extra` field. `asset_payload` is the
// asset-name suffix shared between the user and reference tokens (i.e. the
// bytes after the CIP-67 label prefix).
pub fn ref_token_input(
  policy_id: PolicyId,
  asset_payload: ByteArray,
  royalty_included: Option<Int>,
) -> Input {
  let extra: Metadata =
    when royalty_included is {
      None -> []
      Some(n) -> {
        let value: Data = n
        [Pair(royalty_included_key, value)]
      }
    }

  let ref_datum = RefDatumMetadata { metadata: [], version: 1, extra }
  let user_tn = bytearray.concat(user_tn_prefix, asset_payload)

  Input {
    output_reference: placeholder_oref(),
    output: Output {
      address: Address {
        payment_credential: VerificationKeyCredential(""),
        stake_credential: None,
      },
      value: value.from_asset(policy_id, get_ref_tn(user_tn), 1),
      datum: InlineDatum(ref_datum),
      reference_script: None,
    },
  }
}

// ------ to_string Utilities for Tracing Purposes ------

pub fn output_to_string(output: Output) -> String {
  let value_string =
    string.join(
      value.flatten_with(output.value, asset_to_string),
      @"\n",
    )

  let address_string = address_to_cred_hash(output.address)

  string.join(
    [
      @"\nOutput:",
      string.concat(@"Address: ", address_string),
      string.concat(@"Value: ", value_string),
      @"",
    ],
    @"\n",
  )
}

fn asset_to_string(
  policy_id: PolicyId,
  asset_name: AssetName,
  amt: Int,
) -> Option<String> {
  Some(
    string.join(
      [
        string.from_bytearray(policy_id),
        string.from_bytearray(asset_name),
        string.from_int(amt),
      ],
      @" ",
    ),
  )
}

pub fn payout_to_string(payout: Payout) -> String {
  let address_string = address_to_cred_hash(payout.recipient)

  let amt_string = string.from_int(payout.amount)
  string.join(
    [
      @"\nPayout: ",
      string.concat(@"Address: ", address_string),
      string.concat(@"Amount: ", amt_string),
      @"",
    ],
    @"\n",
  )
}

// UNSAFE - this appears to have some side affects
pub fn address_to_cred_hash(address: Address) -> String {
  when address.payment_credential is {
    VerificationKeyCredential(hash) -> string.from_bytearray(hash)
    ScriptCredential(hash) -> string.from_bytearray(hash)
  }
}
