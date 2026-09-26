import { APPROVAL_DOMAIN, CLOSE_APPROVAL_TYPES, CONSENT_REQUEST_TYPES } from "@omniagent/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { DecisionLog } from "../src/log";
import { validateClose, validateConsentRequest } from "../src/validate";

const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const account = "0x000000000000000000000000000000000000dEaD";
const NOW = 1_900_000_000n;
const opts = { chainId: 10143, nowSec: NOW, isNonceUsed: () => false };

async function closeBody(overrides: Record<string, bigint> = {}, signer = owner) {
  const message = { owner: owner.address, account, perpId: 32n, nonce: 1n, deadline: NOW + 300n, ...overrides } as const;
  const signature = await signer.signTypedData({
    domain: APPROVAL_DOMAIN(10143),
    types: CLOSE_APPROVAL_TYPES,
    primaryType: "ClosePosition",
    message,
  });
  const wire = Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
  return { approval: { message: wire, signature } };
}

describe("validateClose", () => {
  it("accepts the owner's signature", async () => {
    const v = await validateClose(await closeBody(), opts);
    expect(v.message.perpId).toBe(32n);
  });
  it("rejects strangers, expired approvals, reused nonces and unknown markets", async () => {
    await expect(validateClose(await closeBody({}, stranger), opts)).rejects.toThrow(/not from the owner/);
    await expect(validateClose(await closeBody({ deadline: NOW - 1n }), opts)).rejects.toThrow(/expired/);
    await expect(validateClose(await closeBody(), { ...opts, isNonceUsed: () => true })).rejects.toThrow(/nonce/);
    await expect(validateClose(await closeBody({ perpId: 999n }), opts)).rejects.toThrow(/unknown perpId/);
  });
});

describe("validateConsentRequest", () => {
  const sign = (signer = owner, deadline = NOW + 300n) =>
    signer
      .signTypedData({
        domain: APPROVAL_DOMAIN(10143),
        types: CONSENT_REQUEST_TYPES,
        primaryType: "ConsentRequest",
        message: { owner: owner.address, deadline },
      })
      .then(signature => ({ owner: owner.address, deadline: deadline.toString(), signature }));

  it("returns the owner for a valid request", async () => {
    expect(await validateConsentRequest(await sign(), { chainId: 10143, nowSec: NOW })).toBe(owner.address);
  });
  it("rejects a request signed by someone else, expired, or with a far deadline", async () => {
    await expect(validateConsentRequest(await sign(stranger), { chainId: 10143, nowSec: NOW })).rejects.toThrow(/not signed/);
    await expect(validateConsentRequest(await sign(owner, NOW - 1n), { chainId: 10143, nowSec: NOW })).rejects.toThrow(/expired/);
    await expect(validateConsentRequest(await sign(owner, NOW + 7200n), { chainId: 10143, nowSec: NOW })).rejects.toThrow(/too far/);
    await expect(validateConsentRequest({ owner: owner.address }, { chainId: 10143, nowSec: NOW })).rejects.toThrow(/malformed/);
  });
});

describe("DecisionLog.sideForMarket", () => {
  const entry = (over: Record<string, unknown>) => ({
    ts: "t",
    kind: "plan" as const,
    owner: owner.address,
    account,
    nonce: String(Math.random()),
    planHash: "0x",
    mode: "live" as const,
    status: "sent" as const,
    ...over,
  });

  it("uses the latest open the worker actually sent, and forgets it after a close", () => {
    const log = new DecisionLog(mkdtempSync(join(tmpdir(), "omni-side-")));
    // dry-run and unsent live orders must not count in live mode
    log.append(entry({ mode: "dry-run", status: "built", detail: [{ order: { perpId: "32", orderType: 0 } }] }));
    log.append(entry({ status: "failed", detail: [{ order: { perpId: "32", orderType: 0 } }] }));
    expect(log.sideForMarket(account, 32n, "live")).toBeUndefined();
    expect(log.sideForMarket(account, 32n, "dry-run")).toBe("long");

    log.append(entry({ detail: [{ order: { perpId: "32", orderType: 1 }, txHash: "0xabc" }] }));
    expect(log.sideForMarket(account, 32n, "live")).toBe("short");
    expect(log.sideForMarket(account, 16n, "live")).toBeUndefined();

    log.append(entry({ kind: "close", detail: { perpId: "32" } }));
    expect(log.sideForMarket(account, 32n, "live")).toBeUndefined();
  });
});
