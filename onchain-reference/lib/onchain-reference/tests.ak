use aiken/bytearray
use aiken/list
use aiken/transaction.{Input, Output, OutputReference, TransactionId}
use onchain_reference/common.{RoyaltyInfo, RoyaltyRecipient}

pub fn mk_tx_hash(n: Int) -> TransactionId {
  expect n < 256
  let h =
    bytearray.push(
      #"00000000000000000000000000000000000000000000000000000000000000",
      n,
    )
  TransactionId { hash: h }
}

pub fn recipients_to_input(recipients: List<RoyaltyRecipient>) -> Input {
  let mock_outref =
    OutputReference {
      transaction_id: transaction.placeholder().id,
      output_index: 0,
    }

  Input {
    output_reference: mock_outref,
    output: recipients_to_output(recipients),
  }
}

pub fn recipients_to_output(recipients: List<RoyaltyRecipient>) -> Output {
  let out_royalty_info = RoyaltyInfo { recipients, version: 1, extra: None }

  todo
}
