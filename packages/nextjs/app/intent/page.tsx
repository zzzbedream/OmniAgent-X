"use client";

// Intent → plan → risk check → passkey approval (EIP-712) → worker execution (dry-run unless enabled).
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  APPROVAL_DOMAIN,
  type IntentParams,
  PERPL_TESTNET,
  PLAN_APPROVAL_TYPES,
  PLAN_REQUEST_TYPES,
  type RiskReport,
  type TradePlan,
  planRequestHash,
  usdToMicro,
} from "@omniagent/core";
import type { NextPage } from "next";
import type { Address, Hex } from "viem";
import { loadDelegatedAccount, worker } from "~~/lib/omni/worker";
import { useMera } from "~~/services/mera/MeraProvider";

type StrategyResponse = {
  budgetUsd: number;
  quotes: { market: string; markPriceUsd: number }[];
  intent: IntentParams;
  plan: TradePlan;
  planHash: Hex;
  risk: RiskReport;
  telemetry: Record<string, { model: string; latencyMs: number; usage: Record<string, number | undefined> }>;
};

const EXAMPLE =
  "Despliega 1,000 USD. Haz coberturas cortas en ETH si hay alta volatilidad y deja el resto como colchón.";

const Intent: NextPage = () => {
  const { account, walletClient } = useMera();
  const [delegated, setDelegated] = useState<Address>();
  const [request, setRequest] = useState(EXAMPLE);
  const [budget, setBudget] = useState("100");
  const [result, setResult] = useState<StrategyResponse>();
  const [execution, setExecution] = useState<Record<string, unknown>>();
  const [err, setErr] = useState<string>();
  const [loading, setLoading] = useState<"plan" | "approve">();

  useEffect(() => {
    if (account) setDelegated(loadDelegatedAccount(account.address));
  }, [account]);

  const plan = async () => {
    setLoading("plan");
    setErr(undefined);
    setResult(undefined);
    setExecution(undefined);
    try {
      if (!account || !walletClient || !delegated) throw new Error("inicia sesión y crea tu cuenta de trading primero");
      // Authenticates the paid planning call: bound to this exact text and budget, valid 5 minutes.
      const budgetUsd = Number(budget);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
      const signature = await walletClient.signTypedData({
        domain: APPROVAL_DOMAIN(PERPL_TESTNET.chainId),
        types: PLAN_REQUEST_TYPES,
        primaryType: "PlanRequest",
        message: {
          owner: account.address,
          account: delegated,
          requestHash: planRequestHash(request, budgetUsd),
          deadline,
        },
      });
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request,
          budgetUsd,
          auth: { owner: account.address, account: delegated, deadline: deadline.toString(), signature },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`${body.error}${body.missing ? ` (${body.missing.join(", ")})` : ""}`);
      setResult(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(undefined);
    }
  };

  const approve = async () => {
    if (!result || !account || !walletClient || !delegated) return;
    setLoading("approve");
    setErr(undefined);
    try {
      const message = {
        owner: account.address,
        account: delegated,
        planHash: result.planHash,
        budgetMicroUsd: usdToMicro(result.budgetUsd),
        nonce: BigInt(Date.now()),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
      };
      const signature = await walletClient.signTypedData({
        domain: APPROVAL_DOMAIN(PERPL_TESTNET.chainId),
        types: PLAN_APPROVAL_TYPES,
        primaryType: "PlanApproval",
        message,
      });
      const wireMessage = Object.fromEntries(
        Object.entries(message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
      );
      setExecution(
        await worker.submitPlan({
          plan: result.plan,
          budgetUsd: result.budgetUsd,
          approval: { message: wireMessage, signature },
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(undefined);
    }
  };

  return (
    <div className="flex flex-col grow pt-8 px-4 gap-5 max-w-xl mx-auto w-full">
      <h1 className="text-2xl font-bold">Estrategia</h1>
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

      <label className="form-control gap-1">
        <span className="text-sm">¿Qué quieres que haga el agente?</span>
        <textarea
          className="textarea textarea-bordered h-28"
          value={request}
          onChange={e => setRequest(e.target.value)}
          maxLength={1000}
        />
      </label>
      <label className="form-control gap-1">
        <span className="text-sm">Presupuesto de margen (USD de colateral asignado al agente)</span>
        <input
          className="input input-bordered"
          inputMode="decimal"
          value={budget}
          onChange={e => setBudget(e.target.value)}
        />
      </label>
      <button
        className="btn btn-primary"
        disabled={!!loading || !(Number(budget) > 0) || !account || !delegated}
        onClick={plan}
      >
        {loading === "plan" ? "Consultando Kimi y Qwen…" : "Generar plan"}
      </button>

      {err && <p className="text-error text-sm break-words">{err}</p>}

      {result && (
        <section className="card bg-base-100 shadow p-4 gap-3">
          <h2 className="font-semibold">Plan propuesto</h2>
          {result.intent.unsupported.length > 0 && (
            <p className="text-warning text-sm">No soportado (se ignora): {result.intent.unsupported.join("; ")}</p>
          )}
          <ul className="text-sm list-disc pl-5">
            {result.plan.orders.map((o, i) => (
              <li key={i}>
                {o.side === "long" ? "Largo" : "Corto"} {o.market}: {o.notionalUsd} USD nocional a {o.leverage}x (margen{" "}
                {(o.notionalUsd / o.leverage).toFixed(2)} USD)
              </li>
            ))}
            {result.plan.orders.length === 0 && <li>Sin órdenes: el modelo no encontró nada que encaje.</li>}
          </ul>
          <p className="text-sm">{result.plan.summary}</p>
          <p className="text-xs opacity-70">{result.plan.riskNotes}</p>
          <div className={`alert ${result.risk.ok ? "alert-success" : "alert-error"} text-sm flex-col items-start`}>
            <span>
              Política de riesgo: {result.risk.ok ? "aprobado" : "rechazado"} · margen requerido{" "}
              {result.risk.requiredMarginUsd.toFixed(2)} / {result.budgetUsd} USD
            </span>
            {result.risk.violations.map((v, i) => (
              <span key={i}>• {v.detail}</span>
            ))}
          </div>
          <p className="text-xs opacity-60">
            {Object.entries(result.telemetry)
              .map(
                ([k, t]) =>
                  `${k}: ${t.model} ${t.latencyMs} ms, tokens ${t.usage.promptTokens}/${t.usage.completionTokens}`,
              )
              .join(" · ")}
          </p>
          <button
            className="btn btn-accent"
            disabled={!result.risk.ok || !account || !delegated || !!loading}
            onClick={approve}
          >
            {loading === "approve" ? "Firmando y enviando…" : "Aprobar con passkey y enviar al agente"}
          </button>
        </section>
      )}

      {execution && (
        <section className="card bg-base-100 shadow p-4 gap-2">
          <h2 className="font-semibold">Resultado del agente</h2>
          <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(execution, null, 2)}</pre>
        </section>
      )}
    </div>
  );
};

export default Intent;
