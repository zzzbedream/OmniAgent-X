// OmniAgent X — live end-to-end QA as a brand-new user, in headless Chromium with a virtual passkey (PRF).
// Real PWA, real worker, real Monad testnet: passkey → gas station → trading account → allowlist → deposit →
// plan → live order → position → close → withdraw. Each step is timed, screenshotted, and checked on-chain at the end.
// Costs per run: 0.5 MON from the worker's gas station, ~0.01 AUSD of fees, 2 LLM calls. Needs EXECUTION_ENABLED=true.
// Playwright is not a repo dependency; run it from a scratch folder:
//   npm i playwright@1.58 viem@2.31.1 && npx playwright install chromium
//   node live-e2e.mjs <outDir> [baseUrl]
// If a step fails after the order is open, the close and withdraw steps still run (the virtual passkey dies with
// the browser, so a position left open could never be closed again).
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, formatEther, formatUnits, http, parseAbi } from "viem";
import { monadTestnet } from "viem/chains";

const out = process.argv[2] ?? "qa-out";
const base = process.argv[3] ?? "https://omniagent-app.147-93-178-184.sslip.io";
mkdirSync(out, { recursive: true });

const EXCHANGE = "0x1964C32f0bE608E7D29302AFF5E61268E72080cc";
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const OPERATOR = "0xA900773d87C3769074a238E9b572588559D2DA46";
const chain = createPublicClient({ chain: monadTestnet, transport: http("https://testnet-rpc.monad.xyz") });

const results = [];
let stepNo = 0;
async function step(name, fn, { soft = false } = {}) {
  const t0 = Date.now();
  stepNo++;
  try {
    const detail = await fn();
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    results.push({ step: name, ok: true, s, detail });
    console.log(`✅ ${stepNo}. ${name} (${s} s)${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    results.push({ step: name, ok: false, s, detail: e.message.split("\n")[0] });
    console.log(`❌ ${stepNo}. ${name} (${s} s) — ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: join(out, `FAIL-${String(stepNo).padStart(2, "0")}.png`), fullPage: true }).catch(() => {});
    console.log("activity:", (await activity()).slice(0, 5));
    // A soft step only checks the UI; later steps still run so a live position is never left open.
    if (!soft) throw e;
  } finally {
    await page.screenshot({ path: join(out, `${String(stepNo).padStart(2, "0")}-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
  }
}

const local = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
const ctx = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  recordVideo: { dir: out, size: { width: 375, height: 812 } },
});
const page = await ctx.newPage();
page.on("dialog", d => d.accept()); // the withdraw confirmation
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable", { enableUI: false });
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
    hasPrf: true,
  },
});

const tab = name => page.locator("nav.fixed").getByRole("link", { name });
const activity = async () => page.locator("section[aria-label='Actividad'] li").allTextContents().catch(() => []);
const waitActivity = (re, timeout) =>
  page.waitForFunction(
    r => [...document.querySelectorAll("section[aria-label='Actividad'] li")].some(li => new RegExp(r).test(li.textContent ?? "")),
    re.source,
    { timeout },
  );
const failIfActivity = async re => {
  const bad = (await activity()).find(l => re.test(l));
  if (bad) throw new Error(bad);
};

let owner;
let txOpen;
let txClose;

try {
  await step("Abrir Cuenta", async () => {
    await page.goto(`${base}/onboard`, { waitUntil: "networkidle" });
  });

  await step("Crear passkey", async () => {
    await page.getByPlaceholder("Nombre para el passkey").fill(`qa-${Date.now()}`);
    await page.getByRole("button", { name: "Crear passkey" }).click();
    const addr = page.locator("span.num.break-all").first();
    await addr.waitFor({ timeout: 30_000 });
    owner = (await addr.textContent()).trim();
    return owner;
  });

  await step("Gas y AUSD automáticos (estación)", async () => {
    await waitActivity(/gas de prueba recibido|fondos de prueba falló|ya los recibió/, 90_000);
    await failIfActivity(/fondos de prueba falló/);
    await page.waitForFunction(() => /Gas:\s*0\.[1-9]/.test(document.body.innerText), null, { timeout: 30_000 });
    return (await activity()).filter(l => /prueba/.test(l)).length + " movimientos";
  });

  await step("Crear cuenta de trading (passkey)", async () => {
    await page.getByRole("button", { name: "Crear cuenta de trading" }).click();
    await waitActivity(/cuenta delegada: 0x|crear cuenta delegada falló|worker no disponible/, 120_000);
    await failIfActivity(/falló|no disponible/);
    return (await activity()).find(l => /cuenta delegada: 0x/.test(l))?.match(/0x[0-9a-fA-F]{40}/)?.[0];
  });

  await step("Reparar permisos del agente (passkey, 9 tx)", async () => {
    const repair = page.getByRole("button", { name: "Reparar permisos" });
    await repair.waitFor({ timeout: 30_000 });
    await repair.click();
    await page.getByRole("heading", { name: "Permisos del agente desactualizados" }).waitFor({ state: "detached", timeout: 240_000 });
    await failIfActivity(/falló/);
  });

  await step("Depositar 100 AUSD y abrir cuenta (passkey)", async () => {
    await page.getByRole("button", { name: "Depositar y abrir" }).click();
    await waitActivity(/crear cuenta en el exchange: confirmada|falló/, 120_000);
    await failIfActivity(/falló/);
    await page.waitForFunction(() => /EN EL EXCHANGE\s*100/i.test(document.body.innerText), null, { timeout: 30_000 });
  });

  await step("Generar plan (DeepSeek + reglas)", async () => {
    await tab("Estrategia").click();
    await page.getByRole("button", { name: "Generar plan" }).click();
    await page.getByText(/Riesgo aprobado|Plan rechazado/).first().waitFor({ timeout: 90_000 });
    if (await page.getByText("Plan rechazado por las reglas").count()) throw new Error("plan rejected by the rules");
    const ticket = (await page.locator("article").first().innerText()).replace(/\s+/g, " ");
    // The planner must answer in the user's language (Spanish request → Spanish reasoning).
    const reasoning = (await page.locator("article details summary").first().innerText()).replace(/\s+/g, " ");
    const spanishHits = (reasoning.match(/\b(el|la|de|en|con|para|corto|posición|riesgo|apalancamiento)\b/gi) ?? []).length;
    const englishHits = (reasoning.match(/\b(the|with|for|short|position|risk|leverage)\b/gi) ?? []).length;
    if (spanishHits <= englishHits) throw new Error(`reasoning not in Spanish: ${reasoning.slice(0, 160)}`);
    return `${ticket.slice(0, 60)} | ${reasoning.slice(0, 110)}`;
  });

  await step("Aprobar con passkey → orden real", async () => {
    await page.getByRole("button", { name: "Aprobar con passkey" }).click();
    const result = page.locator("section[aria-label='Resultado del agente']");
    await result.waitFor({ timeout: 90_000 });
    const text = (await result.innerText()).replace(/\s+/g, " ");
    if (!/En vivo/i.test(text) || !/Enviada a Perpl/i.test(text)) throw new Error(text.slice(0, 200));
    txOpen = await result.locator("a[href*='/tx/']").first().getAttribute("href");
    // After the agent answers, the button must say the plan was sent and stay disabled (no double submit).
    const sent = page.getByRole("button", { name: /Plan enviado al agente/ });
    await sent.waitFor({ timeout: 10_000 });
    if (!(await sent.isDisabled())) throw new Error("approve button still enabled after the agent answered");
    return txOpen;
  });

  await step("Ver la posición en Riesgo", async () => {
    await tab("Riesgo").click();
    const row = page.locator("article", { hasText: "-PERP" }).first();
    await row.waitFor({ timeout: 60_000 });
    // The side must be known (indexer or worker log) and shown as a status chip, never "Lado ?".
    await page.locator("section[aria-label='Posiciones'] :is(.chip-short, .chip-long)").first().waitFor({ timeout: 45_000 });
    // Sub-cent PnL must read 0.00, never "-0".
    const summary = (await page.locator("section[aria-label='Resumen de la cuenta']").innerText()).replace(/\s+/g, " ");
    const rowText = (await row.innerText()).replace(/\s+/g, " ");
    if (/-0(?![.,\d])/.test(summary) || /-0(?![.,\d])/.test(rowText)) throw new Error(`"-0" PnL shown: ${rowText.slice(0, 80)}`);
    return rowText.slice(0, 120);
  }, { soft: true });

  await step("Cerrar con passkey", async () => {
    await page.getByRole("button", { name: "Cerrar con passkey" }).click();
    await page.getByText(/live · sent|live · failed|dry-run/).first().waitFor({ timeout: 90_000 });
    const res = await page.locator("section[aria-label='Posiciones'] p.num").first().innerText();
    if (!/live · sent/.test(res)) throw new Error(res);
    txClose = res.match(/0x[0-9a-fA-F]{64}/)?.[0];
    await page.getByText("Sin posiciones abiertas.").waitFor({ timeout: 60_000 });
    return txClose;
  });

  await step("Retirar a la wallet (confirmación + passkey)", async () => {
    await tab("Cuenta").click();
    const hero = page.locator("text=En el exchange").locator("xpath=..");
    await hero.waitFor({ timeout: 30_000 });
    const bal = Number((await hero.innerText()).match(/([\d.]+)\s*AUSD/)?.[1] ?? "0");
    const amount = Math.floor(bal * 100) / 100;
    await page.getByLabel("Monto").fill(String(amount));
    await page.getByRole("button", { name: "Retirar" }).click();
    await waitActivity(/retirar colateral: confirmada|retirar.*falló/, 90_000);
    await failIfActivity(/retirar.*falló/);
    return `${amount} AUSD`;
  });
} catch {
  // reported by step()
} finally {
  await ctx.close(); // flushes the video
  await browser.close();
}

// On-chain verification of what the UI claimed.
if (owner) {
  const erc = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const [mon, ausd] = await Promise.all([
    chain.getBalance({ address: owner }),
    chain.readContract({ address: AUSD, abi: erc, functionName: "balanceOf", args: [owner] }),
  ]);
  console.log(`\nOn-chain owner ${owner}: MON ${Number(formatEther(mon)).toFixed(4)}, AUSD ${formatUnits(ausd, 6)}`);
  for (const [label, url] of [["open", txOpen], ["close", txClose]]) {
    const hash = url?.match(/0x[0-9a-fA-F]{64}/)?.[0];
    if (!hash) continue;
    const r = await chain.getTransactionReceipt({ hash });
    console.log(`${label} tx ${hash}: ${r.status}, from operator ${r.from.toLowerCase() === OPERATOR.toLowerCase()}`);
  }
}
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} steps passed. Screenshots and video in ${out}`);
process.exitCode = passed === results.length ? 0 : 1;
