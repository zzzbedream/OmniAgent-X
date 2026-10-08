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
import { type GuardianStatus, WORKER_URL, loadDelegatedAccount, worker } from "~~/lib/omni/worker";
import { useMera } from "~~/services/mera/MeraProvider";

const EXAMPLE =
  "Si mi distancia a liquidación baja de 15%, agrega 20 USD de colateral. Si baja de 8%, reduce la mitad. Si baja de 4%, cierra todo.";
const TTL_OPTIONS = [1, 7, 30] as const;
const POLL_MS = 10_000;
const AGENT_ID = /^\d+$/.test(process.env.NEXT_PUBLIC_GUARDIAN_AGENT_ID ?? "")
  ? BigInt(process.env.NEXT_PUBLIC_GUARDIAN_AGENT_ID as string)
  : undefined;

const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const toWire = (m: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

const Guardian: NextPage = () => {
  const { account, walletClient } = useMera();
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
    if (account) setDelegated(loadDelegatedAccount(account.address));
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
    const load = () => refresh().catch(e => !cancelled && setErr(`agente: ${(e as Error).message}`));
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
      if (!account || !walletClient || !delegated) throw new Error("inicia sesión y crea tu cuenta de trading primero");
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
    <div className="flex flex-col grow pt-8 px-4 gap-5 max-w-xl mx-auto w-full">
      <h1 className="text-2xl font-bold">Guardián</h1>
      <p className="text-sm opacity-80">
        Dile al agente cómo protegerte. Firmas una vez con tu passkey y vigila tus posiciones cada pocos segundos: puede
        reducir o cerrar, nunca retirar tus fondos.
      </p>
      {!account && (
        <p className="alert alert-warning">
          Primero inicia sesión con tu passkey en{" "}
          <Link className="link" href="/onboard">
            Cuenta
          </Link>
          .
        </p>
      )}
      {account && !delegated && (
        <p className="alert alert-warning">
          Aún no tienes cuenta de trading.{" "}
          <Link className="link" href="/onboard">
            Créala aquí
          </Link>
          .
        </p>
      )}

      {status && <GuardianStatusCard status={status} isRevoking={busy === "revoke"} onRevoke={revoke} />}

      <label className="form-control gap-1">
        <span className="text-sm">Tus reglas de protección</span>
        <textarea
          className="textarea textarea-bordered h-28"
          value={text}
          maxLength={1000}
          onChange={e => setText(e.target.value)}
        />
      </label>
      <button className="btn btn-primary" disabled={!canSign || text.trim().length < 5} onClick={compile}>
        {busy === "compile" ? "Traduciendo…" : "Traducir reglas"}
      </button>

      {err && <p className="text-error text-sm break-words">{err}</p>}

      {compiled && (
        <>
          <MandatePreview compiled={compiled} addCollateralEnabled={status?.guardian.addCollateralEnabled} />
          <label className="form-control gap-1">
            <span className="text-sm">Vigencia del mandato</span>
            <select
              className="select select-bordered"
              value={ttlDays}
              onChange={e => setTtlDays(Number(e.target.value) as (typeof TTL_OPTIONS)[number])}
            >
              {TTL_OPTIONS.map(d => (
                <option key={d} value={d}>
                  {d === 1 ? "1 día" : `${d} días`}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-accent" disabled={!canSign || blocked} onClick={activate}>
            {busy === "activate"
              ? "Firmando…"
              : status?.active
                ? "Reemplazar mandato con passkey"
                : "Activar con passkey"}
          </button>
        </>
      )}

      <ShockSimulator mandate={compiled?.mandate ?? status?.mandate} maintenanceFraction={maintenance} />

      <section className="flex flex-col gap-2 pb-10">
        <h2 className="font-semibold">Historial del guardián</h2>
        <GuardianFeed entries={feed} onRate={AGENT_ID !== undefined && walletClient ? rate : undefined} />
      </section>
    </div>
  );
};

export default Guardian;
