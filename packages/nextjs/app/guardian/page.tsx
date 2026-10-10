"use client";

// Guardian: plain-language protection rules → mandate preview → one passkey signature → the worker
// protects the account 24/7 (it can reduce or close, never withdraw).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  APPROVAL_DOMAIN,
  type CompiledMandate,
  ERC8004_TESTNET,
  GUARDIAN_MANDATE_TYPES,
  GUARDIAN_REVOKE_TYPES,
  PERPL_TESTNET,
  PLAN_REQUEST_TYPES,
  guardianFeedback,
  guardianRequestHash,
  marginFractionFromRaw,
  reputationRegistryAbi,
} from "@omniagent/core";
import type { NextPage } from "next";
import type { Address } from "viem";
import { type DecisionEntry, type GuardianActionType, GuardianFeed } from "~~/app/guardian/_components/GuardianFeed";
import { GuardianStatusCard } from "~~/app/guardian/_components/GuardianStatusCard";
import { MandatePreview } from "~~/app/guardian/_components/MandatePreview";
import { ShockSimulator } from "~~/app/guardian/_components/ShockSimulator";
import { resolveDelegatedAccount } from "~~/lib/omni/account";
import { type GuardianStatus, WORKER_URL, worker } from "~~/lib/omni/worker";
import { useMera } from "~~/services/mera/MeraProvider";

/**
 * One-tap rule sets. "Demo" fires on the next tick for any position up to 3x (whose distance to liquidation is
 * well under 50%), so a collateral top-up can be shown live; the others are realistic protections.
 */
const RULE_PRESETS = [
  {
    label: "Conservative",
    text: "If my distance to liquidation falls below 15%, add 20 USD of collateral. Below 8%, reduce by half. Below 4%, close everything.",
  },
  {
    label: "Demo: instant top-up",
    text: "If distance to liquidation falls below 50%, add 2 USD of collateral. Below 5%, close the position.",
  },
  { label: "Close only", text: "If distance to liquidation falls below 10%, close the position." },
] as const;

const EXAMPLE =
  "If my distance to liquidation falls below 15%, add 20 USD of collateral. Below 8%, reduce by half. Below 4%, close everything.";
const TTL_OPTIONS = [1, 7, 30] as const;
const POLL_MS = 10_000;
const AGENT_ID = /^\d+$/.test(process.env.NEXT_PUBLIC_GUARDIAN_AGENT_ID ?? "")
  ? BigInt(process.env.NEXT_PUBLIC_GUARDIAN_AGENT_ID as string)
  : undefined;

const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const toWire = (m: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

const Guardian: NextPage = () => {
  const { account, walletClient, confirm } = useMera();
  const [delegated, setDelegated] = useState<Address>();
  const [text, setText] = useState(EXAMPLE);
  const [compiled, setCompiled] = useState<CompiledMandate>();
  const [ttlDays, setTtlDays] = useState<(typeof TTL_OPTIONS)[number]>(7);
  const [status, setStatus] = useState<GuardianStatus>();
  const [feed, setFeed] = useState<DecisionEntry[]>([]);
  const [maintenance, setMaintenance] = useState<number | null>(null);
  const [busy, setBusy] = useState<"compile" | "activate" | "revoke">();
  const [err, setErr] = useState<string>();

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void resolveDelegatedAccount(account.address).then(r => !cancelled && setDelegated(r?.address));
    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    fetch("/api/perpl/context")
      .then(r => r.json())
      .then((b: { markets?: { symbol: string; maintenanceMarginRaw: number }[] }) =>
        setMaintenance(marginFractionFromRaw(b.markets?.find(m => m.symbol === "BTC")?.maintenanceMarginRaw)),
      )
      .catch(() => setMaintenance(null));
  }, []);

  const refresh = useCallback(async () => {
    if (!delegated) return;
    const [s, d] = await Promise.all([worker.guardianStatus(delegated), worker.decisions(delegated)]);
    setStatus(s);
    setFeed(d.entries as DecisionEntry[]);
  }, [delegated]);

  useEffect(() => {
    if (!delegated) return;
    let cancelled = false;
    const load = () => refresh().catch(e => !cancelled && setErr(`agent: ${(e as Error).message}`));
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [delegated, refresh]);

  const guarded = async (kind: "compile" | "activate" | "revoke", fn: () => Promise<void>) => {
    setBusy(kind);
    setErr(undefined);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const compile = () =>
    guarded("compile", async () => {
      if (!account || !walletClient || !delegated) throw new Error("sign in and create your trading account first");
      setCompiled(undefined);
      // Authenticates the paid compile call, bound to this exact text, valid 4 minutes.
      const deadline = nowSec() + 240n;
      const signature = await walletClient.signTypedData({
        domain: APPROVAL_DOMAIN(PERPL_TESTNET.chainId),
        types: PLAN_REQUEST_TYPES,
        primaryType: "PlanRequest",
        message: { owner: account.address, account: delegated, requestHash: guardianRequestHash(text), deadline },
      });
      const res = await fetch("/api/guardian/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          auth: { owner: account.address, account: delegated, deadline: deadline.toString(), signature },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error([body.error, body.message, body.missing?.join(", ")].filter(Boolean).join(" — "));
      setCompiled(body as CompiledMandate);
    });

  const activate = () =>
    guarded("activate", async () => {
      if (!compiled || !account || !walletClient || !delegated) return;
      // Fingerprint / Face ID before the guardian may act on the account.
      await confirm();
      const message = {
        owner: account.address,
        account: delegated,
        mandateHash: compiled.mandateHash,
        nonce: BigInt(Date.now()),
        expiresAt: nowSec() + BigInt(ttlDays * 86_400),
      };
      const signature = await walletClient.signTypedData({
        domain: APPROVAL_DOMAIN(PERPL_TESTNET.chainId),
        types: GUARDIAN_MANDATE_TYPES,
        primaryType: "GuardianMandate",
        message,
      });
      await worker.activateGuardian({ mandate: compiled.mandate, approval: { message: toWire(message), signature } });
      setCompiled(undefined);
      await refresh();
    });

  const revoke = () =>
    guarded("revoke", async () => {
      if (!account || !walletClient || !delegated) return;
      await confirm();
      const message = {
        owner: account.address,
        account: delegated,
        nonce: BigInt(Date.now()),
        deadline: nowSec() + 300n,
      };
      const signature = await walletClient.signTypedData({
        domain: APPROVAL_DOMAIN(PERPL_TESTNET.chainId),
        types: GUARDIAN_REVOKE_TYPES,
        primaryType: "GuardianRevoke",
        message,
      });
      await worker.revokeGuardian({ message: toWire(message), signature });
      await refresh();
    });

  // ERC-8004 feedback from the owner's Mera account (not the agent owner, as the standard requires).
  const rate = async (args: { txHash: `0x${string}`; action: GuardianActionType; helpful: boolean }) => {
    if (!walletClient || AGENT_ID === undefined) throw new Error("feedback not configured");
    await walletClient.writeContract({
      address: ERC8004_TESTNET.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "giveFeedback",
      args: guardianFeedback({ agentId: AGENT_ID, workerUrl: WORKER_URL, ...args }),
    });
  };

  const canSign = !!account && !!walletClient && !!delegated && !busy;
  const blocked = !!compiled && compiled.violations.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[560px] grow flex-col gap-5 px-4 pt-6">
      <h1 className="text-[28px] font-bold tracking-tight">Guardian</h1>
      <p className="text-sm text-ash">
        Tell the agent how to protect you. You sign once with your passkey and it watches your positions every few
        seconds: it can add collateral, reduce or close, never withdraw your funds.
      </p>
      {!account && (
        <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
          First sign in with your passkey in{" "}
          <Link className="link" href="/onboard">
            Account
          </Link>
          .
        </p>
      )}
      {account && !delegated && (
        <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
          You have no trading account yet.{" "}
          <Link className="link" href="/onboard">
            Create it here
          </Link>
          .
        </p>
      )}

      {status && <GuardianStatusCard status={status} isRevoking={busy === "revoke"} onRevoke={revoke} />}

      <label className="form-control gap-1">
        <span className="text-sm">Your protection rules</span>
        <textarea
          className="textarea textarea-bordered w-full bg-raised h-28"
          value={text}
          maxLength={1000}
          onChange={e => setText(e.target.value)}
        />
      </label>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {RULE_PRESETS.map(p => (
          <button
            key={p.label}
            type="button"
            onClick={() => setText(p.text)}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors ${
              text === p.text
                ? "border-violet bg-violet-wash text-bone"
                : "border-line bg-raised text-ash hover:border-violet hover:text-bone"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!canSign || text.trim().length < 5} onClick={compile}>
        {busy === "compile" ? "Translating…" : "Translate rules"}
      </button>

      {err && <p className="text-short text-sm break-words">{err}</p>}

      {compiled && (
        <>
          <MandatePreview compiled={compiled} addCollateralEnabled={status?.guardian.addCollateralEnabled} />
          <label className="form-control gap-1">
            <span className="text-sm">Mandate validity</span>
            <select
              className="select select-bordered w-full bg-raised"
              value={ttlDays}
              onChange={e => setTtlDays(Number(e.target.value) as (typeof TTL_OPTIONS)[number])}
            >
              {TTL_OPTIONS.map(d => (
                <option key={d} value={d}>
                  {d === 1 ? "1 day" : `${d} days`}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary h-12" disabled={!canSign || blocked} onClick={activate}>
            {busy === "activate"
              ? "Signing…"
              : status?.active
                ? "Replace mandate with passkey"
                : "Activate with passkey"}
          </button>
        </>
      )}

      <ShockSimulator mandate={compiled?.mandate ?? status?.mandate} maintenanceFraction={maintenance} />

      <section className="flex flex-col gap-2 pb-10">
        <h2 className="font-semibold">Guardian history</h2>
        <GuardianFeed entries={feed} onRate={AGENT_ID !== undefined && walletClient ? rate : undefined} />
      </section>
    </div>
  );
};

export default Guardian;
