// Passkey → EVM account, following the official Mera recipe
// (category-labs/mera docs/recipes/create-passkey-accounts.mdx, v0.2.0).
//
// WARNING: changing the derivation below (BIP-39 wordlist, BIP-44 path, index)
// changes every user's address. Treat it as a frozen format.
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
} from "@category-labs/mera";
import type { PasskeyCredentialMetadata, Secp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const CREDENTIAL_STORAGE_KEY = "omniagent.meraCredential";
export const EVM_DERIVATION_PATH = (index: number) => `m/44'/60'/0'/0/${index}`;

export type MeraEvmAccount = {
  address: `0x${string}`;
  session: Secp256k1SigningSession;
  credentialId: string;
};

function loadCredential(): PasskeyCredentialMetadata | undefined {
  try {
    const raw = localStorage.getItem(CREDENTIAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PasskeyCredentialMetadata) : undefined;
  } catch {
    return undefined;
  }
}

function saveCredential(credential: PasskeyCredentialMetadata) {
  try {
    localStorage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(credential));
  } catch {
    // Storage unavailable (private mode): sign-in still works via discoverable credentials.
  }
}

function deriveEvmAccount(prfOutput: Uint8Array, index = 0) {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(EVM_DERIVATION_PATH(index));
  if (node.privateKey === null) throw new Error("derivation produced no key");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  node.wipePrivateData();
  return { session, address: getEvmAddress(session.publicKey) as `0x${string}` };
}

/** First run: creates a NEW passkey (every call adds one) and derives account #0. */
export async function createMeraAccount(userName: string): Promise<MeraEvmAccount> {
  const rpId = location.hostname;
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId, name: "OmniAgent X" },
    user: { name: userName, displayName: userName },
  });
  saveCredential({ credentialId: created.credentialId, transports: created.transports });
  const { session, address } = deriveEvmAccount(created.prfOutput);
  return { session, address, credentialId: created.credentialId };
}

/** Returning user: one biometric prompt, same PRF output → same address. */
export async function signInMeraAccount(): Promise<MeraEvmAccount> {
  const known = loadCredential();
  const { prfOutput, credentialId } = await getPasskeyPrfOutput({ rpId: location.hostname, credential: known });
  saveCredential(known?.credentialId === credentialId ? known : { credentialId });
  const { session, address } = deriveEvmAccount(prfOutput);
  return { session, address, credentialId };
}

export function toViem(account: MeraEvmAccount) {
  return toViemAccount(account.session);
}
