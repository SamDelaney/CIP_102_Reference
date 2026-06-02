import { BlockfrostProvider } from "@meshsdk/provider";
import { getEnv } from "./env.ts";

const address = getEnv("WALLET_ADDRESS");
const projectId = getEnv("BLOCKFROST_PROJECT_KEY");

console.log(address);

const provider = new BlockfrostProvider(projectId);
const utxos = await provider.fetchAddressUTxOs(address);

console.log(JSON.stringify(utxos, null, 2));
