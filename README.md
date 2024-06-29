# The Official CIP 102 Reference Implementation

A reference implementation for [CIP-0102](https://cips.cardano.org/cip/CIP-0102) royalties, written in Lucid (offchain) and Aiken (onchain).

In this reference implementation you'll find examples of:

- Minting a CIP 102 compliant NFT with royalties
- Validators for storing royalty metadata
  - Always Fails (royalty cannot be modified)
  - Reducible (royalty cannot be increased, but can be decreased)
- Reading a CIP 102 NFT’s royalties off chain
- Reading and validating against CIP 102 NFT royalties on chain

## Use & Structure

This repository is divided into two parts: offchain (transaction building) & onchain (transaction validation).

The `offchain-reference` subdirectory is written in Typescript, making heavy use of the [Lucid](https://github.com/spacebudz/lucid) offchain transaction building library.

The `onchain-reference` subdirectory is written in [Aiken](https://aiken-lang.org/), a Cardano-specific onchain transaction validation language.

Both sub-directories have instructions for use in their own README files at their own roots.

## Disclaimers

This code has not been audited and is NOT INTENDED FOR PRODUCTION, but to provide code examples of expected behavior.

I still have some cleanup for clarity and consistency to be done here, and may dabble in some optimizations; however, it's now fully featured & ready for review by interested parties who don't mind digging through some sub-optimal code. Feedback is very welcome :)