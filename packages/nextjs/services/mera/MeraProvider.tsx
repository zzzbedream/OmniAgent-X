"use client";

// App-wide Mera session. The signing key lives only in memory for the tab's lifetime; a reload
// requires one more biometric prompt (Sign in), by design.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { isMeraError } from "@category-labs/mera";
import {
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { monadTestnet } from "viem/chains";
import {
  type MeraEvmAccount,
  confirmMeraAccount,
  createMeraAccount,
  signInMeraAccount,
  toViem,
} from "~~/lib/mera/account";

const RPC_URL = process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC || undefined;

export const publicClient: PublicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });

type MeraContextValue = {
  account?: MeraEvmAccount;
  walletClient?: WalletClient<Transport, Chain, Account>;
  busy: boolean;
  error?: string;
  create: (userName: string) => Promise<void>;
  signIn: () => Promise<void>;
  /**
   * Biometric confirmation for one user action (approve a plan, close, deposit, withdraw…). Throws a readable
   * error when cancelled or when another passkey answers. Call it once per action, right before signing.
   */
  confirm: () => Promise<void>;
  end: () => void;
};

const MeraContext = createContext<MeraContextValue | null>(null);

export function describeMeraError(e: unknown): string {
  if (isMeraError(e)) {
    if (e.code === "PRF_UNAVAILABLE") {
      return "Este dispositivo o gestor de contraseñas no soporta WebAuthn PRF. Usa iOS 18+ (Safari) o Android con Google Password Manager.";
    }
    return `${e.code}: ${e.message}`;
  }
  return (e as Error).message;
}

export function MeraProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<MeraEvmAccount>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = useCallback(async (fn: () => Promise<MeraEvmAccount>) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await fn();
      setAccount(prev => {
        prev?.session.end();
        return next;
      });
    } catch (e) {
      setError(describeMeraError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const end = useCallback(() => {
    setAccount(prev => {
      prev?.session.end();
      return undefined;
    });
  }, []);

  const walletClient = useMemo(
    () =>
      account
        ? createWalletClient({ account: toViem(account), chain: monadTestnet, transport: http(RPC_URL) })
        : undefined,
    [account],
  );

  const value: MeraContextValue = {
    account,
    walletClient,
    busy,
    error,
    create: userName => run(() => createMeraAccount(userName)),
    signIn: () => run(signInMeraAccount),
    confirm: async () => {
      if (!account) throw new Error("inicia sesión con tu passkey primero");
      try {
        await confirmMeraAccount(account);
      } catch (e) {
        throw new Error(`Confirmación con passkey fallida: ${describeMeraError(e)}`);
      }
    },
    end,
  };
  return <MeraContext.Provider value={value}>{children}</MeraContext.Provider>;
}

export function useMera() {
  const ctx = useContext(MeraContext);
  if (!ctx) throw new Error("useMera must be used inside MeraProvider");
  return ctx;
}
