"use client";

import Link from "next/link";
import { DEFAULT_TESTNET_POLICY } from "@omniagent/core";
import type { NextPage } from "next";
import { ArrowRightIcon, CheckCircleIcon, FingerPrintIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { MarketsTicker } from "~~/components/omni/MarketsTicker";
import { PipelineRail } from "~~/components/omni/PipelineRail";
import { useMera } from "~~/services/mera/MeraProvider";

const PIPELINE_CAPTIONS = ["En español", "DeepSeek", "Límites duros", "Tu firma", "Perpl"] as const;

const STEPS = [
  { title: "Crea tu passkey", body: "Face ID o huella. Sin frase semilla: la clave vive en tu dispositivo (Mera)." },
  { title: "Abre tu cuenta de trading", body: "Una cuenta delegada de Perpl. Tú eres el dueño; el agente solo opera." },
  {
    title: "Describe tu estrategia",
    body: "La IA arma un plan y las reglas deterministas lo aprueban o rechazan entero.",
  },
  {
    title: "Aprueba y vigila el riesgo",
    body: "Firmas el plan exacto. El panel de riesgo muestra posiciones y liquidación.",
  },
] as const;

const Home: NextPage = () => {
  const { account } = useMera();
  const P = DEFAULT_TESTNET_POLICY;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-10 px-4 pt-8 lg:max-w-5xl">
      <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-5">
          <span className="chip border-violet/40 bg-violet-wash text-violet self-start">
            Copiloto de trading passkey-native
          </span>
          <h1 className="text-[44px] font-bold leading-[1.02] tracking-[-0.03em] sm:text-6xl">
            Tu riesgo,
            <br />
            <span className="text-violet">en tus palabras.</span>
          </h1>
          <p className="max-w-md text-[17px] leading-relaxed text-ash">
            La IA propone. Las reglas deciden. Tú firmas con tu passkey. Un agente ejecuta en Perpl, sobre Monad.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {account ? (
              <Link href="/intent" className="btn btn-primary h-12 px-6 text-base">
                Ir a Estrategia <ArrowRightIcon className="h-5 w-5" aria-hidden />
              </Link>
            ) : (
              <Link href="/onboard" className="btn btn-primary h-12 px-6 text-base">
                <FingerPrintIcon className="h-5 w-5" aria-hidden /> Crear passkey
              </Link>
            )}
            <Link href="/onboard" className="text-center text-sm text-ash hover:text-bone">
              {account ? "Ver mi cuenta" : "Ya tengo passkey"} →
            </Link>
          </div>
        </div>

        {/* Hero artefact: what the product produces, a checked trade ticket waiting for a signature. */}
        <div className="relative mx-auto w-full max-w-sm">
          <div
            className="absolute inset-0 translate-x-3 translate-y-3 rounded-[var(--radius-box)] border border-line"
            aria-hidden
          />
          <div className="relative rotate-[-2deg] rounded-[var(--radius-box)] border border-line-strong bg-raised p-4 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between">
              <span className="num text-[11px] text-smoke">TICKET 01 · ETH-PERP · IOC</span>
              <span className="chip-short">Corto</span>
            </div>
            <p className="num mt-3 text-3xl font-semibold text-short">
              CORTO <span className="text-bone">ETH</span>
            </p>
            <div className="num mt-3 grid grid-cols-3 gap-2 text-sm">
              <span>
                <span className="label-caps block">Nocional</span>5.00
              </span>
              <span>
                <span className="label-caps block">Apalanc.</span>1x
              </span>
              <span>
                <span className="label-caps block">Margen</span>5.00
              </span>
            </div>
            <div className="mt-4 border-t border-dashed border-line-strong pt-3 text-sm">
              <span className="flex items-center gap-2 text-long">
                <CheckCircleIcon className="h-4 w-4" aria-hidden /> 5/5 reglas · riesgo aprobado
              </span>
              <span className="mt-1 flex items-center gap-2 text-ash">
                <FingerPrintIcon className="h-4 w-4 text-violet" aria-hidden /> Esperando tu passkey
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel flex flex-col gap-4 p-4" aria-label="Cómo decide el agente">
        <header className="flex items-center justify-between">
          <h2 className="label-caps">Flujo de decisión</h2>
          <span className="num text-[11px] text-violet">el modelo propone · el código decide</span>
        </header>
        <PipelineRail current={3} captions={PIPELINE_CAPTIONS} />
      </section>

      <section className="flex flex-col gap-4" aria-label="Custodia">
        <h2 className="text-2xl font-bold tracking-tight">
          El agente opera. <span className="text-violet">Nunca retira.</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="panel flex flex-col gap-2 p-4">
            <span className="flex items-center gap-2 text-sm font-semibold text-long">
              <CheckCircleIcon className="h-5 w-5" aria-hidden /> Puede
            </span>
            <ul className="flex flex-col gap-1.5 text-sm text-ash">
              <li>Abrir y cerrar posiciones</li>
              <li>Solo en {P.allowedMarkets.join(" · ")}</li>
              <li>Hasta {P.maxLeverage}x y dentro de tu presupuesto</li>
            </ul>
          </div>
          <div className="flex flex-col gap-2 rounded-[var(--radius-box)] border border-short/30 bg-short/5 p-4">
            <span className="flex items-center gap-2 text-sm font-semibold text-short">
              <LockClosedIcon className="h-5 w-5" aria-hidden /> No puede
            </span>
            <ul className="flex flex-col gap-1.5 text-sm text-ash">
              <li>Retirar fondos: solo tu passkey puede</li>
              <li>Operar sin tu firma del plan exacto</li>
              <li>Saltarse las reglas: un plan que rompe una se rechaza entero</li>
            </ul>
          </div>
        </div>
      </section>

      <MarketsTicker />

      <section className="flex flex-col gap-4" aria-label="Cómo funciona">
        <h2 className="text-2xl font-bold tracking-tight">Cómo funciona</h2>
        <ol className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0">
          {STEPS.map((s, i) => (
            <li key={s.title} className="panel flex w-64 shrink-0 snap-start flex-col gap-2 p-4 lg:w-auto">
              <span className="num w-fit rounded border border-line-strong bg-violet-wash px-1.5 text-xs text-violet">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-ash">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="num text-center text-xs tracking-wide text-smoke">Mera passkeys · Perpl · Monad · DeepSeek</p>
    </div>
  );
};

export default Home;
