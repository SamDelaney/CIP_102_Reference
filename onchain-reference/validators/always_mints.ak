// parameterize against an identifying keyphrase to keep the policyId unique
//
// REMEMBER TO PARAMETERIZE - THE SCRIPT WILL ALWAYS SUCCEED WITHOUT PARAMETERS
validator always_mints(_key: ByteArray) {
  mint(_redeemer: Data, _policy_id: Data, _self: Data) {
    True
  }
}