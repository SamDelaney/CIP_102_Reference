import { MeshWallet, WalletStaticMethods } from "@meshsdk/wallet";
import { BlockfrostProvider } from "@meshsdk/provider";
import { buildKeys } from "@meshsdk/core-cst";
import { bech32 } from "bech32";
import { getEnv, updateEnv } from "./env.ts";

const projectId = getEnv("BLOCKFROST_PROJECT_KEY");
const cardanoNetwork = getEnv("PUBLIC_CARDANO_NETWORK");
const networkId = cardanoNetwork === "mainnet" ? 1 : 0;

const provider = new BlockfrostProvider(projectId);

const words = MeshWallet.brew() as string[];
const wallet = new MeshWallet({
  networkId,
  fetcher: provider,
  key: { type: "mnemonic", words },
});
await wallet.init();

const address = await wallet.getChangeAddress();

// Derive the payment signing key at m/1852'/1815'/0'/0/0.
// buildKeys takes the 192-char BIP32 root hex and returns the extended
// Ed25519 payment key (64 bytes: 32-byte scalar + 32-byte nonce).
// Encode it as ed25519e_sk bech32 so mock-frontend.ts can sign correctly.
const bip32RootHex = WalletStaticMethods.mnemonicToPrivateKeyHex(words);
const { paymentKey } = buildKeys(bip32RootHex, 0, 0);
const extKeyBytes = Buffer.from(paymentKey.hex(), "hex");
const privateKeyBech32 = bech32.encode(
  "ed25519e_sk",
  bech32.toWords(extKeyBytes),
  1000,
);

const envUpdate = {
  WALLET_ADDRESS: address,
  WALLET_PRIVATE_KEY: privateKeyBech32,
};
updateEnv(envUpdate);
console.log("Generated wallet address:", address);

// Force clean exit: @meshsdk/transaction's libsodium WASM initializes
// asynchronously and its deferred .ready rejection crashes Node 22.
process.exit(0);
