"use client";

import { useEffect, useRef, useState } from "react";
import { MARKET_SYMBOLS, type MarketSymbol, readPerpSnapshot } from "@omniagent/core";
import { publicClient } from "~~/services/mera/MeraProvider";

const REFRESH_MS = 15_000;

type Quote = { mark: number; first: number };

/** Live Perpl testnet marks, read on-chain (same reads the worker uses). Change is since the page opened. */
export const MarketsTicker = () => {
  const [quotes, setQuotes] = useState<Partial<Record<MarketSymbol, Quote>>>({});
  const [hasError, setHasError] = useState(false);
  const firstSeen = useRef<Partial<Record<MarketSymbol, number>>>({});

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      try {
        const snaps = await Promise.all(MARKET_SYMBOLS.map(m => readPerpSnapshot(publicClient, m)));
        if (!isActive) return;
        const next: Partial<Record<MarketSymbol, Quote>> = {};
        MARKET_SYMBOLS.forEach((m, i) => {
          const mark = Number(snaps[i].markPNS) / 10 ** Number(snaps[i].priceDecimals);
          firstSeen.current[m] ??= mark;
          next[m] = { mark, first: firstSeen.current[m] as number };
        });
        setQuotes(next);
        setHasError(false);
      } catch {
        if (isActive) setHasError(true);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      isActive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section aria-label="Live markets" className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="num text-[12px] uppercase tracking-[0.18em] text-ash">Live perp markets</h2>
        <span className="num flex items-center gap-1.5 text-[11px] text-smoke">
          <span className={`h-1.5 w-1.5 ${hasError ? "bg-short" : "bg-long animate-pulse"}`} aria-hidden />
          {hasError ? "offline" : "Perpl testnet · on-chain"}
        </span>
      </header>
      <div className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4">
        {MARKET_SYMBOLS.map(m => {
          const q = quotes[m];
          const change = q && q.first > 0 ? ((q.mark - q.first) / q.first) * 100 : 0;
          return (
            <div key={m} className="flex flex-col gap-2 bg-void py-5 pr-4 sm:pl-5 sm:first:pl-0">
              <span className="num text-[11px] uppercase tracking-[0.16em] text-smoke">{m}-PERP</span>
              <span className="num text-[28px] font-semibold leading-none tracking-tight">
                {q ? q.mark.toLocaleString("en-US", { maximumFractionDigits: q.mark < 1 ? 5 : 2 }) : "—"}
              </span>
              <span
                className={`num text-[11px] ${change > 0 ? "text-long" : change < 0 ? "text-short" : "text-smoke"}`}
              >
                {q ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}% session` : "loading"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};
