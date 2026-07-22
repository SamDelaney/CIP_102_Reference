# The Official CIP 102 Reference Implementation

A reference implementation for [CIP-0102](https://cips.cardano.org/cip/CIP-0102) royalties, written in Mesh (offchain) and Aiken (onchain).

This implementation supports both CIP-102 v1 (a single base `(500)Royalty` token) and CIP-102 v2: optional positive-integer postfixes (e.g. `(500)Royalty2`).

In this reference implementation you'll find examples of:

- Minting a CIP 102 compliant NFT with royalties
- Validators for storing royalty metadata
  - Always Fails (royalty cannot be modified)
  - Reducible (royalty cannot be increased, but can be decreased)
- Reading a CIP 102 NFT’s royalties off chain
- Reading and validating against CIP 102 NFT royalties on chain

## Use & Structure

This repository is divided into two parts: offchain (transaction building) & onchain (transaction validation).

The `offchain-reference` subdirectory is written in Typescript, making heavy use of the [Mesh](https://meshjs.dev/) offchain transaction building library.

The `onchain-reference` subdirectory is written in [Aiken](https://aiken-lang.org/), a Cardano-specific onchain transaction validation language.

Both sub-directories have instructions for use in their own README files at their own roots.

## Disclaimers

This code has not been audited and is NOT INTENDED FOR PRODUCTION, but to provide code examples of expected behavior.

Several solutions are done in slightly suboptimal ways for clarity's or labor efficiency's sake. Feedback & contributions (in the form of Issues or Pull Requests) are very welcome :)
