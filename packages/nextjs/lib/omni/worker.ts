// Client for packages/agent-worker.
import type { Address, Hex } from "viem";

export const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8787";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = body.details ? ` — ${JSON.stringify(body.details)}` : "";
    throw new Error(`${body.error ?? `worker HTTP ${res.status}`}${details}`);
  }
  return body as T;
}

export type OperatorConsent = { operator: Address; owner: Address; nonce: string; deadline: string; signature: Hex };

export const worker = {
  health: () => call<{ ok: boolean; operator: Address; executionEnabled: boolean }>("/health"),
  /** Body: { owner, deadline, signature } — a ConsentRequest signed by the owner (see core CONSENT_REQUEST_TYPES). */
  consent: (body: { owner: Address; deadline: string; signature: Hex }) =>
    call<OperatorConsent>("/operator/consent", { method: "POST", body: JSON.stringify(body) }),
  submitPlan: (body: unknown) =>
    call<Record<string, unknown>>("/plans", { method: "POST", body: JSON.stringify(body) }),
  close: (body: unknown) => call<Record<string, unknown>>("/close", { method: "POST", body: JSON.stringify(body) }),
  decisions: (account: Address) =>
    call<{ entries: Record<string, unknown>[] }>(`/decisions?account=${encodeURIComponent(account)}`),
};

const ACCOUNT_KEY = (owner: Address) => `omniagent.delegatedAccount.${owner.toLowerCase()}`;

export function loadDelegatedAccount(owner: Address): Address | undefined {
  try {
    return (localStorage.getItem(ACCOUNT_KEY(owner)) as Address | null) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveDelegatedAccount(owner: Address, account: Address) {
  try {
    localStorage.setItem(ACCOUNT_KEY(owner), account);
  } catch {
    // Without storage the user re-enters the address; it is also in the factory's DelegatedAccountCreated event.
  }
}
