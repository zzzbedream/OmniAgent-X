import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { type CompileRequestDeps, handleGuardianCompile } from "../src/guardian/compileRequest";
import { APPROVAL_DOMAIN } from "../src/strategy/approval";
import { PLAN_REQUEST_TYPES, guardianRequestHash } from "../src/strategy/requestAuth";

const owner = privateKeyToAccount(`0x${"44".repeat(32)}`);
const account = "0x00000000000000000000000000000000000000aa" as const;
const NOW = 1_900_000_000n;
const TEXT = "Si la distancia a liquidación baja de 8%, reduce la mitad.";
const llm = { name: "parser", baseUrl: "https://llm.test", apiKey: "k", model: "deepseek-flash" };

const draft = {
  mandate: { rules: [{ trigger: { kind: "liquidationBuffer", belowPct: 8 }, action: { type: "reduce", fraction: 0.5 } }] },
  unsupported: [],
};

const okFetch = (async () =>
  new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ message: { content: JSON.stringify(draft) } }] }), {
    status: 200,
  })) as unknown as typeof fetch;

async function body(text = TEXT, signedText = TEXT) {
  const deadline = NOW + 120n;
  const signature = await owner.signTypedData({
    domain: APPROVAL_DOMAIN(10143),
    types: PLAN_REQUEST_TYPES,
    primaryType: "PlanRequest",
    message: { owner: owner.address, account, requestHash: guardianRequestHash(signedText), deadline },
  });
  return { text, auth: { owner: owner.address, account, deadline: deadline.toString(), signature } };
}

function deps(over: Partial<CompileRequestDeps> = {}): CompileRequestDeps {
  return {
    llm,
    missing: [],
    chainId: 10143,
    nowSec: NOW,
    assertEligible: async () => {},
    takeQuota: () => true,
    fetchImpl: okFetch,
    ...over,
  };
}

describe("handleGuardianCompile", () => {
  it("returns the compiled mandate for an eligible, signed request", async () => {
    const out = await handleGuardianCompile(await body(), deps());
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ lines: ["Si la distancia a liquidación baja de 8%: reducir la posición 50%."] });
  });

  it("400 on a malformed body", async () => {
    expect((await handleGuardianCompile({ text: "x" }, deps())).status).toBe(400);
  });

  it("503 when the LLM is not configured, before verifying anything", async () => {
    const out = await handleGuardianCompile(await body(), deps({ llm: null, missing: ["LLM_API_KEY"] }));
    expect(out).toMatchObject({ status: 503, body: { missing: ["LLM_API_KEY"] } });
  });

  it("401 when the signature covers different text", async () => {
    expect((await handleGuardianCompile(await body(TEXT, "otro texto"), deps())).status).toBe(401);
  });

  it("403 when the account is not eligible", async () => {
    const out = await handleGuardianCompile(
      await body(),
      deps({
        assertEligible: async () => {
          throw new Error("signer does not own this DelegatedAccount");
        },
      }),
    );
    expect(out).toMatchObject({ status: 403, body: { message: "signer does not own this DelegatedAccount" } });
  });

  it("429 when the quota is spent, without calling the model", async () => {
    let called = false;
    const spy = (async (...a: Parameters<typeof fetch>) => {
      called = true;
      return okFetch(...a);
    }) as typeof fetch;
    const out = await handleGuardianCompile(await body(), deps({ takeQuota: () => false, fetchImpl: spy }));
    expect(out.status).toBe(429);
    expect(called).toBe(false);
  });

  it("502 when the model reply breaks the schema", async () => {
    const bad = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"mandate":{"rules":[]},"unsupported":[]}' } }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect((await handleGuardianCompile(await body(), deps({ fetchImpl: bad }))).status).toBe(502);
  });
});
