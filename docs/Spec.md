# Minting a CIP 102 compliant NFT with royalties

## Timelocked Minting Policy

- Checks
  - Owner has signed tx
  - Tx validity window is before MP deadline

## Validators

### Always Fails

- Checks nothing
- Returns false or throws error

### Reducible

- Checks
  - tx is signed by recipient
  - amount sent to recipient is < previous amount
  - all other recipients remain the same
    - amount
    - address

## Offchain

- Constructs well formed CIP-68 & CIP-102 Datums
- Sends reference NFT & datum to arbitrary address
- Sends royalty NFT & datum to
  - arbitrary address
  - always-fails script
  - reducible validator

# Reading a CIP 102 NFT’s royalties off chain

- Querying the datum
  - Check if datum is required
  - Request datum
  - Fail depending on whether datum is required
- Parsing the datum

# Reading and validating against CIP 102 NFT royalties on chain

A simple listing contract which locks a CIP 102 NFT & a datum with a price & seller and must pay out royalties according to that price to be withdrawn.

## Onchain

- Royalty datum
  - If empty, check if royalty is required
    - Parse reference datum
    - Fail if royalty field > 1
  - If not, check if royalties are being paid correctly
    - Fail if not
- Listing datum
  - Confirm the amount is getting paid to the seller, minus royalties

## Offchain - TODO

- Find & read the requested listing datum
- Find & read the associated royalty datum using the approach above
- Calculate payments
- Construct & Submit tx

# CIP-102 v2

This implementation supports a single royalty token per mint operation:

- **Token name**: the royalty token asset name is `Royalty` (v1) optionally followed by the UTF-8 decimal digits of a positive integer postfix, e.g. `Royalty2` (v2). A postfixed token always uses royalty datum `version = 2`; the base token normally uses `version = 1`.
- **Selector**: each minted CIP-68 reference datum's `extra` field is a Plutus map that may contain the key `royalty_included` (UTF-8 bytes) with an integer value:
  - absent — v1-compatible, optional discovery of the base `(500)Royalty` token.
  - `0` — explicitly no royalty required; validators must not search for one.
  - `n > 0` — a `(500)Royalty<n>` token is required and must be resolved.
- **On-chain lookup** (`get_recipients` in `onchain-reference/lib/onchain-reference/common.ak`): checks for the base `(500)Royalty` token first (v1 fast path, unconditional). If absent, and the asset being spent is a CIP-68 user token, it reads the `royalty_included` selector from the corresponding reference datum and dispatches as above.
- **Future upgrades** (see [V2_Checklist.md](V2_Checklist.md)): minting multiple distinct royalty policies in one collection and assigning a different postfix per NFT; CIP-88 discovery integration.
