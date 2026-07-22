# onchain-reference

Write validators in the `validators` folder, and supporting functions in the `lib` folder using `.ak` as a file extension.

For example, as `validators/always_true.ak`

```gleam
validator {
  fn spend(_datum: Data, _redeemer: Data, _context: Data) -> Bool {
    True
  }
}
```

## Building

```sh
aiken build
```

## Testing

You can write tests in any module using the `test` keyword. For example:

```gleam
test foo() {
  1 + 1 == 2
}
```

To run all tests, simply do:

```sh
aiken check
```

To run only tests matching the string `foo`, do:

```sh
aiken check -m foo
```

## CIP-102 Validators

- `always_fails.ak` — royalty NFT locked here can never be spent (royalty is immutable).
- `reducible_royalty.ak` — royalty recipients' fees may only be decreased (never increased), and only by a signer of the affected recipient. The `ReduceRedeemer` includes an `asset_name` field identifying which royalty token (base `Royalty` or a v2 `Royalty<n>` postfixed token) is being targeted.
- `minting.ak` — timelocked minting policy for the CIP-68/CIP-102 NFTs (owner-signed, deadline-gated).
- `simple_listing.ak` — example marketplace listing validator that looks up and pays out royalties via `common.ak`'s `get_recipients`.

### CIP-102 v2 selector logic (`lib/onchain-reference/common.ak`)

`get_recipients` first checks for the v1 base `(500)Royalty` token (unconditional fast path). If absent, and the spent asset is a CIP-68 user token, it reads the corresponding CIP-68 reference datum's `extra.royalty_included` key:

- absent → no royalty required (v1-compatible optional discovery).
- `0` → explicitly no royalty.
- `n > 0` → the `(500)Royalty<n>` token is required; its recipients are returned, or the validator fails if it cannot be found.

See `lib/onchain-reference/royalty_selector_test.ak` for tests exercising this logic directly, and `validators/reducible_royalty.ak`'s `should_reduce_postfixed_v2_recipient` / `should_fail_wrong_postfix` tests for an end-to-end example against a real validator.

> **Note on toolchain:** this project targets Aiken CLI `v1.1.21` (stdlib `1.9.0`). Validator handlers use the named-validator syntax (`validator name(...) { spend(...) { ... } }`) and are invoked in tests via `name.handler(...)`. The `compiler.version` field embedded in `plutus.json` may look stale after a toolchain upgrade — that field is not a reliable indicator of the correct CLI version to use; verify with `aiken --version` instead.
