export type DecisionEntry = {
  ts: string;
  kind: string;
  status: string;
  mode: string;
  detail?: { explanation?: string; txHash?: string; error?: string } | unknown;
};

const EXPLORER_TX = "https://testnet.monadscan.com/tx/";
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const LABEL: Record<string, string> = {
  mandate: "Mandato activado",
  revoke: "Mandato revocado",
};

/** Guardian history from the worker's decision log. Links are built only from well-formed tx hashes. */
export function GuardianFeed({ entries }: { entries: DecisionEntry[] }) {
  const rows = entries.filter(e => e.kind === "guardian" || e.kind === "mandate" || e.kind === "revoke");
  if (rows.length === 0) return <p className="text-sm opacity-60">Todavía no hay acciones del guardián.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(e => {
        const d = (e.detail ?? {}) as { explanation?: string; txHash?: string; error?: string };
        const text = d.explanation ?? LABEL[e.kind] ?? e.kind;
        const tx = typeof d.txHash === "string" && TX_HASH.test(d.txHash) ? d.txHash : undefined;
        return (
          <li key={`${e.ts}-${e.kind}-${text}`} className="text-sm border-l-4 border-base-300 pl-3">
            <div className="flex gap-2 items-center flex-wrap">
              <span className="opacity-60 text-xs">{new Date(e.ts).toLocaleString()}</span>
              <span className={`badge badge-sm ${e.status === "failed" ? "badge-error" : "badge-ghost"}`}>
                {e.status}
              </span>
            </div>
            <p>{text}</p>
            {d.error && <p className="text-error text-xs break-words">{d.error}</p>}
            {tx && (
              <a className="link text-xs" href={`${EXPLORER_TX}${tx}`} target="_blank" rel="noopener noreferrer">
                Ver transacción
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
