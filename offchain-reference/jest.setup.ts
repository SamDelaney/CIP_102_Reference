// Provide a default network so modules that read PUBLIC_CARDANO_NETWORK at
// import time (e.g. lib/common/chain.ts) can be imported in unit tests without
// depending on a populated .env. Real values from .env, if present, win.
process.env.PUBLIC_CARDANO_NETWORK ??= "preprod";
