# CIP-102 Offchain Library (Node.js)

This is the Node.js version of the CIP-102 offchain library, migrated from the original Deno implementation.

## Importing

The contents of this library are available to be imported from `index.ts` and will eventually be published to a public package manager.

In the meantime, you can clone or copy the contents of the `/lib/` folder wherever you need it.

## Direct Use

If you want to interact with the library directly without setting up your own project, you can use either the CLI (`scripts/cli.ts`) or the mock frontend (`scripts/mock-frontend.ts`).

### Setup

- Make sure you have [Node.js](https://nodejs.org/) installed.

- Install dependencies:

  ```bash
  npm install
  ```

- Create a Blockfrost project if you don't already have one. These are free up to a certain number of queries.

- Create a `.env` file in the project directory with the structure defined in `.env.example`:
  - Fill in the `PUBLIC_CARDANO_NETWORK` variable with "Preview", "Preprod" or "Mainnet" depending on which network you want to use.
  - Fill in the corresponding `BLOCKFROST_URL`

- Set up your wallet by filling in the `WALLET_ADDRESS` and `WALLET_PRIVATE_KEY` variables.
  - I recommend using `npm run generate-wallet` to generate a new wallet for testing this specifically. Once generated you can send the minimal funds you need for testing to the wallet from your hot wallet or from a testnet faucet.

To verify your setup worked, or if you want to check the contents of the wallet you have connected, I've included a handy `npm run print-utxos` script.

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

### CLI

The CLI (`npm run cli`) is the recommended way to interact with the library from the command line. All parameters are passed as flags.

#### Reading Royalties

Query the royalty information for a given policy ID:

```bash
npm run cli get-royalties <policyId>
```

Example:

```bash
npm run cli get-royalties c0c70f8c897376e09e1b7cdf551e86f1e4a7f5735539e41b089b3c87
```

#### Minting a Collection

Mint a timelocked CIP-68 NFT collection with a CIP-102 royalty. All required parameters are passed as flags:

```bash
npm run cli -- -- mint-collection \
  --name <base-name> \
  --image <ipfs-url> \
  --deadline <ISO-date> \
  --fee <percent> \
  [--size <count>] \
  [--royalty-address <address>]
```

| Flag                | Description                                                         | Required                       |
| ------------------- | ------------------------------------------------------------------- | ------------------------------ |
| `--name`            | Base name for the NFT assets (e.g. `myNFT` → `myNFT0`, `myNFT1`, …) | Yes                            |
| `--image`           | IPFS URL for the NFT image                                          | Yes                            |
| `--deadline`        | Minting deadline in ISO 8601 format (e.g. `2027-12-22T23:59:59Z`)   | Yes                            |
| `--fee`             | Royalty fee as a percentage (e.g. `1.6` for 1.6%)                   | Yes                            |
| `--size`            | Number of NFTs to mint                                              | No (default: `1`)              |
| `--royalty-address` | Royalty recipient address                                           | No (default: `WALLET_ADDRESS`) |

> **Note:** Use `npm run cli -- --` (two `--` separators) before the subcommand when passing flags. The first `--` tells npm to stop processing its own options; the second `--` is passed to the script to signal end of positional arguments. This prevents npm from intercepting flags like `--name` (a reserved npm config key) or warning about unknown ones. Positional arguments (like the policy ID for `get-royalties`) can be passed directly with just one `--`.

Example:

```bash
npm run cli -- -- mint-collection \
  --name "myNFT" \
  --image "ipfs://QmeTkA5bY4P3DUjhdtPc2MsT8G8keb7HAxjccKrLJN2xTz" \
  --deadline "2027-12-22T23:59:59Z" \
  --size 5 \
  --fee 1.6
```

To view all available options:

```bash
npm run cli -- -- --help
```

### Mock Frontend (legacy)

The mock frontend (`scripts/mock-frontend.ts`) is the original script-based interface. Parameters for `mint-collection` are set as hardcoded constants at the top of the `testTimelockedMint` function rather than via CLI flags.

## Migration Notes

This project has been migrated from Deno to Node.js. Key changes include:

- Replaced Deno imports with Node.js equivalents
- Updated environment variable handling to use `process.env` instead of `Deno.env`
- Changed file system operations to use Node.js `fs` module
- Updated import paths to use `.js` extensions for ES modules
- Replaced `lucid-cardano` with `@evolution-sdk/lucid` package

## Available Scripts

- `npm run generate-wallet` - Generate a new wallet for testing
- `npm run print-utxos` - Print UTXOs in the connected wallet
- `npm run cli <command> [options]` - CLI interface (recommended)
- `npm run mock-frontend [action]` - Legacy mock frontend
- `npm test` - Run tests
