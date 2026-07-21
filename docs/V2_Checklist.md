# CIP-0102 v2 — Implementation Checklist

## Scope and constraints

- [x] Keep the existing v1 base-token path: `(500)Royalty`, datum `version = 1`, and no `royalty_included` field.
- [x] Add one optional **positive integer** postfix that applies to every NFT minted by one mint operation, e.g. `(500)Royalty2`.
- [x] For a postfixed token, emit datum `version = 2` and set every minted CIP-68 reference datum's `extra.royalty_included` value to that postfix.
- [x] Record any API choices so further upgrades can replace the scalar postfix with a per-NFT policy assignment.
- [x] Reject `0`, negative, non-integer, and non-finite postfix values at the off-chain boundary. `0` is reserved by the standard for an explicitly royalty-free reference datum, not for a royalty-token postfix.

## 1. Baseline and test harness

- [x] Confirm the working tree is clean and record the current test/build results.
- [x] Add focused Jest tests for royalty helpers; do not depend on Blockfrost or wallet environment variables.
- [x] Confirm `aiken check` runs the existing validator tests.
- [x] Document the commands used for final validation in the pull request.

## 2. Off-chain royalty primitives

- [x] In `offchain-reference/lib/common/royalties.ts`, add a postfix-aware royalty asset-name/unit helper.
- [x] Keep `toRoyaltyUnit(policyId)` as the backwards-compatible base-token helper.
- [x] Add `toRoyaltyUnit(policyId, postfix?)`, or a clearly named equivalent, that appends the UTF-8 decimal representation of the postfix to `Royalty`.
- [x] Extend `toCip102RoyaltyDatum()` to accept an explicit datum version, defaulting to `1`.
- [x] Add unit tests for base, single-digit, and multi-digit postfix names, including `(500)Royalty10`.
- [x] Add tests proving a postfixed token uses version `2` and the base token retains version `1` by default.

## 3. Off-chain minting and reference datum

- [x] Add an optional `royaltyPostfix` parameter to `createRoyalty()` in `offchain-reference/lib/mint.ts`.
- [x] Add an optional `royaltyPostfix` parameter to `mintNFTs()` and thread it through all royalty-token mint/output construction.
- [x] When `royaltyPostfix` is absent, retain current v1 behavior.
- [x] When `royaltyPostfix` is present, mint exactly `(500)Royalty<postfix>` and attach a v2 royalty datum.
- [x] Replace the current constructor-based royalty marker in the CIP-68 reference datum with a Plutus-data map entry whose key is UTF-8 `royalty_included` and whose value is the postfix integer.
- [x] Keep the existing empty `extra` value for the v1 path, so the selector is absent rather than set to `0`.
- [x] Add serialization tests that inspect the reference datum and royalty datum for both v1 and v2 cases.

## 4. Off-chain discovery

- [x] Refactor `extractRoyaltyInfo()` in `offchain-reference/lib/read.ts` so it can select an exact royalty token.
- [x] Add a v2 lookup input: either an explicit postfix or the associated NFT/reference token from which the postfix can be derived.
- [x] Preserve the current policy-ID-only lookup as an explicitly v1/base-token convenience path, rather than treating it as unambiguous v2 discovery.
- [x] If discovery reads a reference datum, implement these rules:
  - [x] `royalty_included > 0`: query the matching postfixed royalty token.
  - [x] `royalty_included = 0`: return no royalty information without a token query.
  - [x] field absent: optionally query base `(500)Royalty` for v1 compatibility.
- [x] Add mocked-provider tests for each selector outcome and for a missing required postfixed token.

## 5. On-chain royalty lookup and enforcement

- [x] In `onchain-reference/lib/onchain-reference/common.ak`, add a helper that constructs the `(500)Royalty<postfix>` asset name using UTF-8 decimal digits.
- [x] Refactor `get_recipients()` to inspect the matching CIP-68 reference datum before choosing a royalty token.
- [x] Preserve v1 behavior when `royalty_included` is absent: the base token is accepted but not required.
- [x] For `royalty_included = 0`, return no recipients and do not require a royalty reference input.
- [x] For `royalty_included > 0`, require a reference input containing the matching postfixed royalty token and read its recipients.
- [x] Fail safely for malformed selector data or invalid negative selectors.
- [x] Ensure the selector is read from the specified `extra` map representation, not the previous constructor marker.

## 6. Reducible validator and shared test helpers

- [x] Update `onchain-reference/validators/reducible_royalty.ak` so it finds the same full royalty asset name on both input and output.
- [x] Choose and document the identifier transport: add the full royalty asset name to `ReduceRedeemer`, or safely derive it from the consumed input.
- [x] Generalize `onchain-reference/lib/onchain-reference/test_utils.ak` so test UTxOs can contain base or postfixed royalty tokens and version 1 or 2 datums.
- [x] Add Aiken tests for:
  - [x] v1 base royalty remains optional when no selector is present.
  - [x] selector `2` requires `(500)Royalty2`.
  - [x] selector `2` rejects the base token and `(500)Royalty1`.
  - [x] selector `0` requires no royalty input or payout.
  - [x] a reducible update of `(500)Royalty2` cannot satisfy validation with `(500)Royalty`.

## 7. CLI and example flow

- [x] Add `--royalty-postfix <positive-integer>` to `mint-collection` in `offchain-reference/scripts/cli.ts`.
- [x] Validate the flag and pass it to `mintNFTs()`.
- [x] Add a `get-royalties` option that can identify the v2 royalty token unambiguously (postfix or NFT/reference asset).
- [x] Update `offchain-reference/scripts/mock-frontend.ts` only if it remains a supported example; otherwise label it as legacy and keep the CLI authoritative.
- [x] Add one documented v1 command example and one v2 command example.

## 8. Documentation and generated artifact

- [x] Update `README.md` to state that the implementation supports v1 and the single-postfix v2 flow.
- [x] Update `Spec.md` with the v2 token-name rule, datum-version rule, and `royalty_included` semantics.
- [x] Update `offchain-reference/README.md` with the new CLI options, discovery limitations, and examples.
- [x] Update `onchain-reference/README.md` with v2 validator behavior and Aiken test instructions.
- [x] Run `aiken build` and commit the regenerated `onchain-reference/plutus.json` with its source changes.

## 9. Final acceptance checklist

- [x] `npm test` passes in `offchain-reference`.
- [x] TypeScript compilation/check passes.
- [x] `aiken check` passes in `onchain-reference`.
- [x] `aiken build` succeeds and `plutus.json` is current.
- [x] Base v1 mint/read behavior remains covered by tests.
- [x] A v2 mint creates `(500)RoyaltyN`, uses royalty datum version `2`, and writes the same positive `royalty_included` value into every minted reference datum.
- [x] A listing using the matching v2 royalty reference input pays the correct recipients.
- [x] A v2 selector cannot be satisfied by the base token or a different postfix.

---

## Future upgrades

Replace the single optional postfix with a collection configuration that supports multiple royalty policies and an assignment per NFT. This upgrade should:

- [ ] Mint multiple distinct `(500)RoyaltyN` tokens in a collection transaction.
- [ ] Associate each NFT with a positive postfix, `0`, or the v1-compatible omitted selector.
- [ ] Make off-chain discovery derive the policy from an NFT/reference datum by default.
- [ ] Add multi-policy transaction and cross-policy isolation tests.
- [ ] Optionally add CIP-88 `cip-details[102]` advertisement and use it as an additional off-chain discovery path.
