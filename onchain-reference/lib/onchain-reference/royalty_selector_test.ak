// Tests for the CIP-102 v2 `royalty_included` selector logic in
// `get_recipients`. Kept in a dedicated module (rather than inside
// `common.ak`) to avoid a circular import with `test_utils.ak`, which itself
// imports from `common.ak`.

use aiken/bytearray
use aiken/dict
use onchain_reference/common.{
  Asset, construct_royalty_tn, get_recipients, user_tn_prefix,
}
use onchain_reference/test_utils.{
  placeholder_recipient, recipients_to_input_named, ref_token_input,
}

const mock_policy_id = "fake_v2_policy_id"

const mock_owner = "some_fake_owner_hash"

const asset_payload = "fake_v2_asset_tn"

fn mock_asset() -> Asset {
  Asset {
    policy_id: mock_policy_id,
    asset_name: bytearray.concat(user_tn_prefix, asset_payload),
    quantity: 1,
  }
}

test v2_selector_finds_matching_postfixed_token() {
  let recipients = [placeholder_recipient(80, mock_owner)]

  let ref_input = ref_token_input(mock_policy_id, asset_payload, Some(2))
  let royalty_input =
    recipients_to_input_named(
      recipients,
      mock_policy_id,
      construct_royalty_tn(Some(2)),
      2,
    )

  get_recipients(mock_asset(), [ref_input, royalty_input], dict.new())
    == recipients
}

test v2_selector_rejects_wrong_postfix() fail {
  let recipients = [placeholder_recipient(80, mock_owner)]

  // Selector demands postfix 2, but only postfix 1 is available on-chain.
  let ref_input = ref_token_input(mock_policy_id, asset_payload, Some(2))
  let royalty_input =
    recipients_to_input_named(
      recipients,
      mock_policy_id,
      construct_royalty_tn(Some(1)),
      2,
    )

  get_recipients(mock_asset(), [ref_input, royalty_input], dict.new())
    == recipients
}

test v2_zero_selector_returns_no_recipients() {
  // Selector explicitly says "no royalty required": don't search for one,
  // even though no royalty token exists anywhere in the reference inputs.
  let ref_input = ref_token_input(mock_policy_id, asset_payload, Some(0))

  get_recipients(mock_asset(), [ref_input], dict.new()) == []
}

test v1_absent_selector_and_no_base_token_returns_no_recipients() {
  // No `royalty_included` key at all (v1-compatible): base token lookup is
  // optional, and since it's absent here, there's nothing to require.
  let ref_input = ref_token_input(mock_policy_id, asset_payload, None)

  get_recipients(mock_asset(), [ref_input], dict.new()) == []
}

test v2_negative_selector_fails() fail {
  let ref_input = ref_token_input(mock_policy_id, asset_payload, Some(-1))

  get_recipients(mock_asset(), [ref_input], dict.new()) == []
}
