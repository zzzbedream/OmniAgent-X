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
import { FingerPrintIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { ExecutionResult } from "~~/components/omni/ExecutionResult";
import { OrderTicket } from "~~/components/omni/OrderTicket";
import { PIPELINE_STEPS, PipelineRail } from "~~/components/omni/PipelineRail";
import { RulesChecklist } from "~~/components/omni/RulesChecklist";
import { ScopeChips } from "~~/components/omni/ScopeChips";
import { resolveDelegatedAccount } from "~~/lib/omni/account";
import { worker } from "~~/lib/omni/worker";
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

// Sized for the 100 AUSD testnet minimum deposit, so the first plan the demo shows is one the rules accept.
const EXAMPLE = "Corto pequeño en ETH, bajo riesgo";
const SUGGESTIONS = ["Corto pequeño en ETH, bajo riesgo", "Largo moderado en BTC a 2x", "Cubrir con un corto en SOL"];

const Intent: NextPage = () => {
  const { account, walletClient, confirm } = useMera();
  const [delegated, setDelegated] = useState<Address>();
  const [request, setRequest] = useState(EXAMPLE);
  const [budget, setBudget] = useState("5");
  const [result, setResult] = useState<StrategyResponse>();
  const [execution, setExecution] = useState<Record<string, unknown>>();
  const [err, setErr] = useState<string>();
  const [loading, setLoading] = useState<"plan" | "approve">();
  const [isLiveWorker, setIsLiveWorker] = useState<boolean>();

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void resolveDelegatedAccount(account.address).then(r => !cancelled && setDelegated(r?.address));
    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    // The worker decides dry-run vs live (EXECUTION_ENABLED); the page only reports it.
    worker
      .health()
      .then(h => setIsLiveWorker(h.executionEnabled))
      .catch(() => setIsLiveWorker(undefined));
  }, []);

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
      // Fingerprint / Face ID before the agent may act on this plan.
      await confirm();
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

  // Where the run is in the pipeline: Instrucción → Plan IA → Reglas → Passkey → Ejecución.
  const executionStatus = (execution as { status?: string } | undefined)?.status;
  const step = execution
    ? executionStatus === "sent"
      ? PIPELINE_STEPS.length
      : 4
    : result
      ? result.risk.ok
        ? 3
        : 2
      : loading === "plan"
        ? 1
        : 0;
  const isStepFailed = (!!result && !result.risk.ok && !execution) || executionStatus === "failed";
  const telemetry = result
    ? Object.entries(result.telemetry)
        .map(([k, t]) => `${k} ${t.model} ${(t.latencyMs / 1000).toFixed(1)} s`)
        .join(" · ")
    : "";

  return (
    <div className="mx-auto flex w-full max-w-[560px] grow flex-col gap-5 px-4 pt-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[28px] font-bold tracking-tight">Estrategia</h1>
          {isLiveWorker !== undefined && (
            <span className={isLiveWorker ? "chip-live" : "chip-sim"}>
              {isLiveWorker ? "Agente en vivo" : "Agente en simulación"}
            </span>
          )}
        </div>
        <p className="text-sm text-ash">Describe tu objetivo. El agente propone, las reglas deciden, tú apruebas.</p>
      </header>

      <ScopeChips budgetUsd={Number(budget) || undefined} />

      <div className="panel p-4">
        <PipelineRail current={step} isFailed={isStepFailed} />
      </div>

      {!account && (
        <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
          Primero inicia sesión con tu passkey en{" "}
          <Link className="link" href="/onboard">
            Cuenta
          </Link>
          .
        </p>
      )}
      {account && !delegated && (
        <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
          Aún no tienes cuenta de trading.{" "}
          <Link className="link" href="/onboard">
            Créala aquí
          </Link>
          .
        </p>
      )}

      <section className="panel flex flex-col gap-4 p-4" aria-label="Tu instrucción">
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">Tu instrucción</span>
          <textarea
            className="textarea textarea-bordered h-24 w-full bg-raised text-[15px]"
            value={request}
            onChange={e => setRequest(e.target.value)}
            maxLength={1000}
          />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setRequest(s)}
              className="shrink-0 rounded-md border border-line bg-raised px-2.5 py-1 text-xs text-ash transition-colors hover:border-violet hover:text-bone"
            >
              {s}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">Presupuesto de margen</span>
          <div className="flex items-center rounded-[var(--radius-field)] border border-line bg-raised focus-within:border-violet">
            <input
              className="num w-full bg-transparent px-3 py-2.5 text-[15px] outline-none"
              inputMode="decimal"
              value={budget}
              onChange={e => setBudget(e.target.value)}
              aria-label="Presupuesto de margen en USD"
            />
            <span className="num pr-3 text-sm text-smoke">USD</span>
          </div>
          <span className="text-xs text-smoke">Colateral que asignas al agente para este plan.</span>
        </label>
        <button
          className="btn btn-primary h-12 w-full"
          disabled={!!loading || !(Number(budget) > 0) || !account || !delegated}
          onClick={plan}
        >
          <SparklesIcon className="h-5 w-5" aria-hidden />
          {loading === "plan" ? "Consultando al modelo…" : "Generar plan"}
        </button>
      </section>

      {err && (
        <p className="rounded-md border border-short/30 bg-short/10 px-3 py-2 text-sm break-words text-short">{err}</p>
      )}

      {result && (
        <>
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-[var(--radius-box)] rounded-br-sm border border-line-strong bg-violet-wash px-3 py-2 text-sm">
              {request}
              <span className="num mt-1 block text-[11px] text-ash">presupuesto {result.budgetUsd} USD</span>
            </p>
          </div>

          {result.intent.unsupported.length > 0 && (
            <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
              No soportado (se ignora): {result.intent.unsupported.join("; ")}
            </p>
          )}

          {result.plan.orders.length === 0 && (
            <p className="panel p-4 text-sm text-ash">Sin órdenes: el modelo no encontró nada que encaje.</p>
          )}
          {result.plan.orders.map((o, i) => (
            <OrderTicket key={`${o.market}-${i}`} order={o} index={i}>
              {i === 0 && (
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                    <span className="flex flex-col gap-1">
                      <span className="label-caps">Razonamiento del modelo</span>
                      <span className="line-clamp-1 text-sm text-ash group-open:line-clamp-none">
                        {result.plan.summary}
                      </span>
                    </span>
                    <span className="text-smoke transition-transform group-open:rotate-180" aria-hidden>
                      ▾
                    </span>
                  </summary>
                  <p className="mt-2 text-xs text-smoke">{result.plan.riskNotes}</p>
                  <p className="num mt-2 text-[11px] text-smoke">{telemetry}</p>
                </details>
              )}
            </OrderTicket>
          ))}

          <RulesChecklist risk={result.risk} budgetUsd={result.budgetUsd} />

          {/* Docked above the tab bar until the agent answers, so the signature is one thumb away. */}
          <div className={`z-20 flex flex-col gap-1.5 ${execution ? "" : "sticky bottom-24 lg:bottom-4"}`}>
            <button
              className="btn btn-primary h-14 w-full text-base"
              // One approval per generated plan: a second tap would send a second live order.
              disabled={!result.risk.ok || !account || !delegated || !!loading || !!execution}
              onClick={approve}
            >
              <FingerPrintIcon className="h-6 w-6" aria-hidden />
              {loading === "approve"
                ? "Confirma con tu huella…"
                : execution
                  ? "Plan enviado al agente ✓"
                  : "Aprobar con passkey"}
            </button>
            <span className="text-center text-[11px] text-smoke">
              Pide tu huella o Face ID · firma EIP-712 del plan exacto · válida 5 min · el agente nunca puede retirar
            </span>
          </div>
        </>
      )}

      {execution && <ExecutionResult execution={execution} />}
    </div>
  );
};

export default Intent;
