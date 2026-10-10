"use client";

import { useState } from "react";

export type DecisionEntry = {
  ts: string;
  kind: string;
  status: string;
  mode: string;
  detail?: { explanation?: string; txHash?: string; error?: string; type?: string } | unknown;
};

export type GuardianActionType = "addCollateral" | "reduce" | "close";

type Props = {
  entries: DecisionEntry[];
  /** Present when ERC-8004 feedback is configured; rates one executed guardian action on-chain. */
  onRate?: (args: { txHash: `0x${string}`; action: GuardianActionType; helpful: boolean }) => Promise<void>;
};

const ACTIONS: readonly string[] = ["addCollateral", "reduce", "close"];

const EXPLORER_TX = "https://testnet.monadscan.com/tx/";
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const LABEL: Record<string, string> = {
  mandate: "Mandate activated",
  revoke: "Mandate revoked",
};

/** Guardian history from the worker's decision log. Links are built only from well-formed tx hashes. */
export function GuardianFeed({ entries, onRate }: Props) {
  const rows = entries.filter(e => e.kind === "guardian" || e.kind === "mandate" || e.kind === "revoke");
  if (rows.length === 0) return <p className="text-sm text-smoke">No guardian actions yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(e => {
        const d = (e.detail ?? {}) as { explanation?: string; txHash?: string; error?: string; type?: string };
        const text = d.explanation ?? LABEL[e.kind] ?? e.kind;
        const tx = typeof d.txHash === "string" && TX_HASH.test(d.txHash) ? d.txHash : undefined;
        return (
          <li key={`${e.ts}-${e.kind}-${text}`} className="text-sm border-l-4 border-base-300 pl-3">
            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-smoke text-xs">{new Date(e.ts).toLocaleString()}</span>
              <span className={e.status === "failed" ? "chip-short" : "chip-muted"}>{e.status}</span>
            </div>
            <p>{text}</p>
            {d.error && <p className="text-short text-xs break-words">{d.error}</p>}
            {tx && (
              <a className="link text-xs" href={`${EXPLORER_TX}${tx}`} target="_blank" rel="noopener noreferrer">
                View transaction
              </a>
            )}
            {tx && onRate && e.kind === "guardian" && e.status === "sent" && d.type && ACTIONS.includes(d.type) && (
              <RateButtons
                onRate={helpful =>
                  onRate({ txHash: tx as `0x${string}`, action: d.type as GuardianActionType, helpful })
                }
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RateButtons({ onRate }: { onRate: (helpful: boolean) => Promise<void> }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const rate = async (helpful: boolean) => {
    setState("sending");
    try {
      await onRate(helpful);
      setState("done");
    } catch {
      setState("error");
    }
  };
  if (state === "done") return <p className="text-xs text-long">Rating recorded on ERC-8004.</p>;
  return (
    <div className="flex gap-2 items-center text-xs mt-1">
      <span className="text-smoke">Did it protect you? (on-chain reputation, ERC-8004)</span>
      <button className="btn btn-xs" disabled={state === "sending"} onClick={() => rate(true)}>
        Yes
      </button>
      <button className="btn btn-xs" disabled={state === "sending"} onClick={() => rate(false)}>
        No
      </button>
      {state === "error" && <span className="text-short">could not send</span>}
    </div>
  );
}
