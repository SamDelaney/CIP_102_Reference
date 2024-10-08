# Using the CIP-102 Offchain Library

## Importing
The contents of this library are available to be imported from `index.ts` and will eventually be published to a public package manager (or two). I will add instructions here when I do.

In the meantime, you can clone or copy the contents of the `/lib/` folder wherever you need it.

## Direct Use

If you want to interact with the library directly without setting up your own project, you can run the code directly with the mock frontend defined in `scripts/mock-frontend.ts`

### Setup

- Make sure you have [Deno](https://deno.com/) installed.

- Create a Blockfrost project if you don't already have one. These are free up to a certain number of queries.

- Create a `.env` file in the parent directory with the structure defined in `.env.example`:
  - Fill in the `PUBLIC_CARDANO_NETWORK` variable with "Preview", "Preprod" or "Mainnet" depending on which network you want to use.
  - Fill in the corresponding `BLOCKFROST_URL`

- Set up your wallet by filling in the `WALLET_ADDRESS` and `WALLET_PRIVATE_KEY` variables.
  - I recommend using `deno task generate-wallet` to generate a new wallet for testing this specifically. Once generated you can send the minimal funds you need for testing to the wallet from your hot wallet or from a testnet faucet.

To verify your setup worked, or if you want to check the contents of the wallet you have connected, I've included a handy `deno task print-utxos` script.

You should see something like this:
```
addr_test1vqhjcudw5m5pmehwtwduts2ayz2rlpm7vjq0ql6exsz6czq2gr7h8
[
  {
    txHash: "6b369bac955857261566812acde749t9d438032ac6633a004cceeb2c4dc5b287",
    outputIndex: 7,
    assets: { lovelace: 9980876490n },
    address: "addr_test1vqhjcudw5m5pmehwtwduts2ayz2rlpm7vjq0ql6exsz6czq2gr7h8",
    datumHash: undefined,
    datum: undefined,
    scriptRef: undefined
  }
]
```

### Reading Royalties
You can query the royalty information for a given collection with the following query:

`deno task get-royalties [policyId]`

This does not return CIP-27 royalties.

### Minting CIP-102 Compliant NFTs
You can mint a collection with multiple CIP-68 nfts & a royalty policy with

`deno task mint-collection`

Instead of using the command line, this takes its parameters from the `mock_` prefixed consts at the start of the `testTimelockedMint` function in `mock-frontend.ts`.