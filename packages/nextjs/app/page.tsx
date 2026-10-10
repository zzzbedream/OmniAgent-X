"use client";

// Landing, "instrument" direction: warm charcoal, technical type, colour only in the data. The hero is the
// product's own instrument (distance to liquidation, with the guardian's thresholds); sections read like a spec sheet.
import Link from "next/link";
import { DEFAULT_TESTNET_POLICY } from "@omniagent/core";
import type { NextPage } from "next";
import { MarketsTicker } from "~~/components/omni/MarketsTicker";
import { Reveal } from "~~/components/omni/Reveal";
import { RiskDial } from "~~/components/omni/RiskDial";
import { useMera } from "~~/services/mera/MeraProvider";

const P = DEFAULT_TESTNET_POLICY;

const PIPELINE = [
  { title: "Intent", body: "You write your goal and your budget in plain language.", tag: "free text" },
  { title: "AI plan", body: "A model drafts the plan. Its output must pass a strict schema.", tag: "LLM → zod" },
  {
    title: "Rules",
    body: `Allowed markets, up to ${P.maxLeverage}x, notional and margin within budget. One failure rejects the whole plan.`,
    tag: "RiskPolicy",
  },
  {
    title: "Passkey",
    body: "You sign the exact plan hash with Face ID or a fingerprint. No seed phrase.",
    tag: "EIP-712",
  },
  {
    title: "Execution",
    body: "The agent simulates every order on-chain and only then sends it to Perpl.",
    tag: "eth_call → IOC",
  },
] as const;

const STEPS = [
  { title: "Create a passkey", body: "Test gas and AUSD arrive on their own." },
  { title: "Open your account", body: "A Perpl delegated account. You are the owner." },
  { title: "Describe the trade", body: "The AI proposes, the rules decide." },
  { title: "Sign and watch", body: "The guardian protects your collateral." },
] as const;

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="num flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-ash">
    <span className="h-1.5 w-1.5 bg-short" aria-hidden />
    {children}
  </p>
);

const Home: NextPage = () => {
  const { account } = useMera();

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col px-5 lg:px-10">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="grid items-center gap-12 pb-16 pt-10 lg:min-h-[calc(100vh-72px)] lg:grid-cols-[1fr_1.05fr] lg:gap-8 lg:pt-0">
        <div className="flex flex-col gap-8">
          <Eyebrow>Trading co-pilot · passkey · Monad</Eyebrow>
          <h1 className="text-[56px] font-bold leading-[0.95] tracking-[-0.02em] sm:text-[84px] lg:text-[104px]">
            Your risk,
            <br />
            in your
            <br />
            words.
          </h1>
          <p className="max-w-[440px] text-xl leading-snug text-ash">
            The AI proposes. The rules decide. You sign with your passkey. An agent executes on Perpl and can never
            withdraw your funds.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={account ? "/intent" : "/onboard"}
              className="num inline-flex h-12 items-center gap-3 bg-bone px-5 text-[13px] font-semibold uppercase tracking-[0.12em] text-void transition-opacity hover:opacity-85"
            >
              {account ? "Go to strategy" : "Create passkey"} <span aria-hidden>→</span>
            </Link>
            <a
              href="#como"
              className="num inline-flex h-12 items-center gap-3 border border-line-strong px-5 text-[13px] uppercase tracking-[0.12em] text-ash transition-colors hover:border-bone hover:text-bone"
            >
              How it works <span aria-hidden>↓</span>
            </a>
          </div>
          <dl className="num grid max-w-[480px] grid-cols-3 border-t border-line pt-5 text-[12px]">
            <div className="flex flex-col gap-1">
              <dt className="uppercase tracking-[0.14em] text-smoke">Markets</dt>
              <dd className="text-bone">{P.allowedMarkets.join(" ")}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="uppercase tracking-[0.14em] text-smoke">Leverage</dt>
              <dd className="text-bone">≤ {P.maxLeverage}x</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="uppercase tracking-[0.14em] text-smoke">Withdrawals</dt>
              <dd className="text-long">you only</dd>
            </div>
          </dl>
        </div>
        <RiskDial />
      </section>

      {/* ── Pipeline ─────────────────────────────────────── */}
      <section id="como" className="scroll-mt-20 border-t border-line py-20">
        <Reveal className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
          <div className="flex flex-col gap-5" data-reveal>
            <Eyebrow>How it decides</Eyebrow>
            <h2 className="text-[44px] font-bold leading-[1] tracking-[-0.01em] sm:text-[56px]">
              The AI proposes.
              <br />
              The code decides.
            </h2>
            <p className="max-w-[360px] text-lg text-ash">
              Nothing the model writes runs directly. Every plan crosses five stages, and any of them can stop it.
            </p>
          </div>
          <ol className="flex flex-col">
            {PIPELINE.map((s, i) => (
              <li
                key={s.title}
                data-reveal
                className="grid grid-cols-[48px_1fr] gap-x-4 gap-y-1 border-t border-line py-5 last:border-b sm:grid-cols-[64px_180px_1fr_auto] sm:items-baseline"
              >
                <span className="num text-[13px] text-smoke">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-2xl font-semibold">{s.title}</span>
                <span className="col-start-2 text-ash sm:col-start-auto">{s.body}</span>
                <span className="num col-start-2 text-[11px] uppercase tracking-[0.14em] text-smoke sm:col-start-auto">
                  {s.tag}
                </span>
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      {/* ── Custody ──────────────────────────────────────── */}
      <section className="border-t border-line py-20">
        <Reveal className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
          <div className="flex flex-col gap-5" data-reveal>
            <Eyebrow>Custody</Eyebrow>
            <h2 className="text-[44px] font-bold leading-[1] tracking-[-0.01em] sm:text-[56px]">
              The agent trades.
              <br />
              <span className="text-ash">It never withdraws.</span>
            </h2>
          </div>
          <div className="grid gap-px bg-line sm:grid-cols-2" data-reveal>
            <div className="flex flex-col gap-4 bg-void p-6 sm:pl-0">
              <p className="num text-[12px] uppercase tracking-[0.16em] text-long">Can</p>
              <ul className="flex flex-col gap-3 text-lg">
                <li>Open and close positions</li>
                <li>Only on {P.allowedMarkets.join(" · ")}</li>
                <li>Add collateral under your mandate</li>
              </ul>
            </div>
            <div className="flex flex-col gap-4 bg-void p-6">
              <p className="num text-[12px] uppercase tracking-[0.16em] text-short">Cannot</p>
              <ul className="flex flex-col gap-3 text-lg">
                <li>Withdraw funds: only your passkey can</li>
                <li>Trade without your signature on the exact plan</li>
                <li>Skip a rule</li>
              </ul>
            </div>
            <p className="num bg-void pt-4 text-[12px] leading-relaxed text-smoke sm:col-span-2">
              Perpl DelegatedAccount · owner = your passkey · operator = the agent · withdrawCollateral is owner-only
            </p>
          </div>
        </Reveal>
      </section>

      {/* ── Markets ──────────────────────────────────────── */}
      <section className="border-t border-line py-16">
        <MarketsTicker />
      </section>

      {/* ── Steps ────────────────────────────────────────── */}
      <section className="border-t border-line py-20">
        <Reveal className="flex flex-col gap-10">
          <div className="flex flex-wrap items-end justify-between gap-6" data-reveal>
            <h2 className="text-[44px] font-bold leading-[1] tracking-[-0.01em] sm:text-[56px]">Four steps.</h2>
            <Link
              href={account ? "/intent" : "/onboard"}
              className="num inline-flex h-12 items-center gap-3 bg-bone px-5 text-[13px] font-semibold uppercase tracking-[0.12em] text-void hover:opacity-85"
            >
              Get started <span aria-hidden>→</span>
            </Link>
          </div>
          <ol className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                data-reveal
                className="flex flex-col gap-3 bg-void py-6 pr-6 sm:pl-6 sm:[&:nth-child(2n+1)]:pl-0 lg:[&:nth-child(2n+1)]:pl-6 lg:first:pl-0"
              >
                <span className="num text-[13px] text-smoke">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-2xl font-semibold">{s.title}</span>
                <span className="text-ash">{s.body}</span>
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      <p className="num border-t border-line py-8 text-[11px] uppercase tracking-[0.18em] text-smoke">
        Mera passkeys · Perpl · Agora AUSD · Monad testnet 10143
      </p>
    </div>
  );
};

export default Home;
