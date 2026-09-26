import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { createWorker } from "../src/server";

// Routes exercised here never reach the RPC: validation fails before any chain call.
const server = createWorker(
  loadConfig({
    OPERATOR_PK: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    DATA_DIR: mkdtempSync(join(tmpdir(), "omni-srv-")),
    ALLOWED_ORIGINS: "http://localhost:3000",
    MONAD_TESTNET_RPC: "http://127.0.0.1:9",
    RATE_LIMIT_PER_MIN: "6",
  }),
);
let base = "";
beforeAll(async () => {
  await new Promise<void>(r => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("worker HTTP", () => {
  it("reports health in dry-run by default", async () => {
    const body = (await (await fetch(`${base}/health`)).json()) as { ok: boolean; operator: string };
    expect(body).toMatchObject({ ok: true, executionEnabled: false });
    expect(body.operator).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
  it("sets CORS only for allowed origins", async () => {
    const ok = await fetch(`${base}/health`, { headers: { origin: "http://localhost:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const no = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("requires an owner signature for consent and validates closes before touching the chain", async () => {
    const consent = await fetch(`${base}/operator/consent`, {
      method: "POST",
      body: JSON.stringify({ owner: "0x000000000000000000000000000000000000dEaD" }),
    });
    expect(consent.status).toBe(400);
    const close = await fetch(`${base}/close`, { method: "POST", body: "{}" });
    expect(close.status).toBe(400);
  });
  it("returns 400 for invalid plans and 404 for unknown routes", async () => {
    const r = await fetch(`${base}/plans`, { method: "POST", body: "{}" });
    expect(r.status).toBe(400);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
  it("rate-limits POST routes per client", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await fetch(`${base}/close`, { method: "POST", body: "{}" })).status);
    expect(statuses).toContain(429);
    expect((await fetch(`${base}/health`)).status).toBe(200); // GET is not limited
  });
});

describe("config", () => {
  it("refuses a missing or malformed operator key", () => {
    expect(() => loadConfig({})).toThrow(/OPERATOR_PK/);
    expect(() => loadConfig({ OPERATOR_PK: "0x1234" })).toThrow(/OPERATOR_PK/);
  });
});
