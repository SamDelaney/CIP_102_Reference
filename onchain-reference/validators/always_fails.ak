use aiken/transaction.{Transaction}

// parameterize against an identifying keyphrase to keep the address unique. addresses with many utxos can be slower to query against.
// by default I recommend using the project's policyId
//
// REMEMBER TO PARAMETERIZE - THE SCRIPT WILL ALWAYS SUCCEED WITHOUT PARAMETERS
validator always_fails(_key: ByteArray) {
  spend(_datum: Option<Data>, _redeemer: Data, _utxo: Data, _tx: Transaction) -> Bool {
    False
  }
}
