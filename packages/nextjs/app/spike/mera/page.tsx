"use client";

// Spike S1 (docs/PLAN.md §4): passkey → same EVM address across sessions → signed tx on Monad testnet.
// Success criterion: the address after "Sign in" equals the one after "Create", on the same device,
// and "Send 0 MON to self" returns a tx hash visible on the testnet explorer.
import { useState } from "react";
import { isMeraError } from "@category-labs/mera";
import type { NextPage } from "next";
import { createWalletClient, http, parseEther } from "viem";
import { monadTestnet } from "viem/chains";
import { type MeraEvmAccount, createMeraAccount, signInMeraAccount, toViem } from "~~/lib/mera/account";

const MeraSpike: NextPage = () => {
  const [account, setAccount] = useState<MeraEvmAccount>();
  const [log, setLog] = useState<string[]>([]);
  const [userName, setUserName] = useState("omniagent-user");

  const push = (line: string) => setLog(prev => [`${new Date().toISOString()} ${line}`, ...prev]);

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      if (isMeraError(e)) push(`${label} failed: MeraError ${e.code} — ${e.message}`);
      else push(`${label} failed: ${(e as Error).message}`);
    }
  };

  const onCreate = () =>
    run("create", async () => {
      account?.session.end();
      const acc = await createMeraAccount(userName);
      setAccount(acc);
      push(`created passkey ${acc.credentialId.slice(0, 12)}… → ${acc.address}`);
    });

  const onSignIn = () =>
    run("sign-in", async () => {
      account?.session.end();
      const acc = await signInMeraAccount();
      setAccount(acc);
      push(`signed in ${acc.credentialId.slice(0, 12)}… → ${acc.address}`);
    });

  const onSendTx = () =>
    run("tx", async () => {
      if (!account) throw new Error("no account");
      const client = createWalletClient({ account: toViem(account), chain: monadTestnet, transport: http() });
      const hash = await client.sendTransaction({ to: account.address, value: parseEther("0") });
      push(`tx sent: ${hash}`);
    });

  const onEnd = () => {
    account?.session.end();
    setAccount(undefined);
    push("session ended (key zeroed)");
  };

  return (
    <div className="flex flex-col items-center grow pt-10 px-4 gap-4 max-w-xl mx-auto w-full">
      <h1 className="text-2xl font-bold">Spike S1 · Mera passkey</h1>
      <p className="text-sm opacity-70">
        Requires a PRF-capable authenticator (iOS 18+ Safari, Android Chrome + Google Password Manager). Desktop Chrome
        local-profile passkeys do not return PRF.
      </p>
      <input
        className="input input-bordered w-full"
        value={userName}
        onChange={e => setUserName(e.target.value)}
        aria-label="Passkey user name"
      />
      <div className="flex flex-wrap gap-2 justify-center">
        <button className="btn btn-primary" onClick={onCreate}>
          Create passkey
        </button>
        <button className="btn btn-secondary" onClick={onSignIn}>
          Sign in
        </button>
        <button className="btn" onClick={onSendTx} disabled={!account}>
          Send 0 MON to self
        </button>
        <button className="btn btn-ghost" onClick={onEnd} disabled={!account}>
          End session
        </button>
      </div>
      <p className="font-mono break-all">{account?.address ?? "no account"}</p>
      <pre className="w-full text-xs bg-base-300 p-3 rounded whitespace-pre-wrap">{log.join("\n")}</pre>
    </div>
  );
};

export default MeraSpike;
