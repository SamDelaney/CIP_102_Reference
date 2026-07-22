use aiken/list
use aiken/transaction.{Input, Output, Transaction}
use aiken/transaction/credential.{Address, VerificationKeyCredential}
use aiken/transaction/value.{PolicyId}
use onchain_reference/common.{
  RoyaltyDatum, RoyaltyRecipient, construct_royalty_tn, get_data, royalty_tn,
}
use onchain_reference/test_utils.{
  recipients_to_input, recipients_to_input_named, recipients_to_output,
  recipients_to_output_named,
}

pub type ReduceRedeemer {
  policy_id: PolicyId,
  // The exact royalty asset name being reduced: the v1 base `royalty_tn` or
  // a CIP-102 v2 postfixed name (see `common.construct_royalty_tn`). This
  // ensures the reduction applies to the same royalty token on both sides
  // of the transaction, rather than assuming there is only ever one.
  asset_name: ByteArray,
}

// parameterize against an identifying keyphrase to keep the address unique. addresses with many utxos can be slower to query against.
// by default I recommend using the project's policyId
//
// REMEMBER TO PARAMETERIZE - THE SCRIPT WILL ALWAYS SUCCEED WITHOUT PARAMETERS
validator reduce(_key: ByteArray) {
  spend(_d: Option<Data>, redeemer: ReduceRedeemer, _utxo: Data, tx: Transaction) -> Bool {

    // find output datum
    expect Some(royalty_output) =
      list.find(
        tx.outputs,
        fn(output) {
          value.quantity_of(output.value, redeemer.policy_id, redeemer.asset_name) == 1
        },
      )

    expect out_royalty_info: RoyaltyDatum =
      get_data(tx.datums, royalty_output.datum)

    // find input datum
    expect Some(royalty_input) =
      list.find(
        tx.inputs,
        fn(input) {
          value.quantity_of(input.output.value, redeemer.policy_id, redeemer.asset_name) == 1
        },
      )

    expect in_royalty_info: RoyaltyDatum =
      get_data(tx.datums, royalty_input.output.datum)

    // check that for each in recipient, there is a corresponding out recipient
    expect
      list.all(
        // for each in recipient
        in_royalty_info.recipients,
        fn(in_recipient) {
          // unwrap the vck
          expect VerificationKeyCredential(sig) =
            in_recipient.address.payment_credential
          list.any(
            // for each out recipient
            out_royalty_info.recipients,
            fn(out_recipient) {
              // find the corresponding out recipient
              if in_recipient.address == out_recipient.address {
                // the recipient has signed the transaction AND
                // the fee has not changed OR
                // the fee has decreased (encoding reverses this)
                list.has(tx.extra_signatories, sig) && in_recipient.fee < out_recipient.fee || in_recipient.fee == out_recipient.fee
              } else {
                False
              }
            },
          )
        },
      )
    True
  }
}

// ############### TESTS ###############
const mock_owner = "some_fake_address_hash"

const mock_policy_id = "some_fake_policy_id"

// reduces an existing 8% royalty to a 1.6% royalty
test should_reduce_recipient() {
  let redeemer = ReduceRedeemer { policy_id: mock_policy_id, asset_name: royalty_tn }

  let in_recipient =
    RoyaltyRecipient {
      address: Address {
        payment_credential: VerificationKeyCredential(mock_owner),
        stake_credential: None,
      },
      fee: 125,
      // 8%
      min_fee: None,
      max_fee: None,
    }

  let input = recipients_to_input([in_recipient], mock_policy_id)

  let outputs =
    [
      recipients_to_output(
        [RoyaltyRecipient { ..in_recipient, fee: 625 }],
        // 1.6%
        mock_policy_id,
      ),
    ]

  let ctx_utxo = input.output_reference
  let tx = get_base_transaction([input], outputs)

  reduce.spend(mock_policy_id, None, redeemer, ctx_utxo, tx)
}

// attempts (and fails) to increase a 1.6% royalty to an 8% royalty
test should_fail_increase_recipient() fail {
  let redeemer = ReduceRedeemer { policy_id: mock_policy_id, asset_name: royalty_tn }

  let in_recipient =
    RoyaltyRecipient {
      address: Address {
        payment_credential: VerificationKeyCredential(mock_owner),
        stake_credential: None,
      },
      fee: 625,
      // 1.6%
      min_fee: None,
      max_fee: None,
    }

  let input = recipients_to_input([in_recipient], mock_policy_id)

  let outputs =
    [
      recipients_to_output(
        [RoyaltyRecipient { ..in_recipient, fee: 125 }],
        // 8%
        mock_policy_id,
      ),
    ]

  let ctx_utxo = input.output_reference
  let tx = get_base_transaction([input], outputs)

  reduce.spend(mock_policy_id, None, redeemer, ctx_utxo, tx)
}

// attempts (and fails) to steal the royalty token, outputting value.zero() back to the validator
test should_fail_no_token() fail {
  let redeemer = ReduceRedeemer { policy_id: mock_policy_id, asset_name: royalty_tn }

  let in_recipient =
    RoyaltyRecipient {
      address: Address {
        payment_credential: VerificationKeyCredential(mock_owner),
        stake_credential: None,
      },
      fee: 625,
      min_fee: None,
      max_fee: None,
    }

  let input = recipients_to_input([in_recipient], mock_policy_id)
  let recipient_output =
    recipients_to_output(
      [RoyaltyRecipient { ..in_recipient, fee: 125 }],
      mock_policy_id,
    )

  let outputs =
    [Output { ..recipient_output, value: value.zero() }]

  let ctx_utxo = input.output_reference
  let tx = get_base_transaction([input], outputs)

  reduce.spend(mock_policy_id, None, redeemer, ctx_utxo, tx)
}

// CIP-102 v2: reduces a postfixed `(500)Royalty2` token's fee, proving the
// reducer isn't limited to the v1 base token.
test should_reduce_postfixed_v2_recipient() {
  let postfixed_tn = construct_royalty_tn(Some(2))
  let redeemer = ReduceRedeemer { policy_id: mock_policy_id, asset_name: postfixed_tn }

  let in_recipient =
    RoyaltyRecipient {
      address: Address {
        payment_credential: VerificationKeyCredential(mock_owner),
        stake_credential: None,
      },
      fee: 125,
      // 8%
      min_fee: None,
      max_fee: None,
    }

  let input =
    recipients_to_input_named([in_recipient], mock_policy_id, postfixed_tn, 2)

  let outputs =
    [
      recipients_to_output_named(
        [RoyaltyRecipient { ..in_recipient, fee: 625 }],
        // 1.6%
        mock_policy_id,
        postfixed_tn,
        2,
      ),
    ]

  let ctx_utxo = input.output_reference
  let tx = get_base_transaction([input], outputs)

  reduce.spend(mock_policy_id, None, redeemer, ctx_utxo, tx)
}

// CIP-102 v2: a redeemer targeting `(500)Royalty2` cannot be satisfied by a
// transaction that only carries the v1 base `(500)Royalty` token.
test should_fail_wrong_postfix() fail {
  let postfixed_tn = construct_royalty_tn(Some(2))
  let redeemer = ReduceRedeemer { policy_id: mock_policy_id, asset_name: postfixed_tn }

  let in_recipient =
    RoyaltyRecipient {
      address: Address {
        payment_credential: VerificationKeyCredential(mock_owner),
        stake_credential: None,
      },
      fee: 125,
      min_fee: None,
      max_fee: None,
    }

  // Only the base token exists on-chain, not the postfixed one the redeemer requires.
  let input = recipients_to_input([in_recipient], mock_policy_id)
  let outputs =
    [
      recipients_to_output(
        [RoyaltyRecipient { ..in_recipient, fee: 625 }],
        mock_policy_id,
      ),
    ]

  let ctx_utxo = input.output_reference
  let tx = get_base_transaction([input], outputs)

  reduce.spend(mock_policy_id, None, redeemer, ctx_utxo, tx)
}

fn get_base_transaction(
  recipients_in: List<Input>,
  recipients_out: List<Output>,
) -> Transaction {
  Transaction {
    ..transaction.placeholder(),
    extra_signatories: [mock_owner],
    inputs: recipients_in,
    outputs: recipients_out,
  }
}
