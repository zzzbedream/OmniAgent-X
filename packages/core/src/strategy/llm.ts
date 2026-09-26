// OpenAI-compatible chat client (both Moonshot/Kimi and Alibaba Model Studio/Qwen expose this shape).
// Base URLs and model ids come from configuration: they are not hard-coded because they were not
// verified from primary docs (see docs/VERIFIED_FACTS.md).
import type { z } from "zod";

export type LlmConfig = { name: string; baseUrl: string; apiKey: string; model: string; timeoutMs?: number };

export type LlmUsage = { promptTokens?: number; completionTokens?: number };

export type LlmResult<T> = { data: T; raw: string; usage: LlmUsage; latencyMs: number; model: string };

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly raw?: string,
  ) {
    super(message);
  }
}

export function llmConfigFromEnv(prefix: "KIMI" | "QWEN", env: Record<string, string | undefined>): LlmConfig | null {
  const baseUrl = env[`${prefix}_BASE_URL`];
  const apiKey = env[`${prefix}_API_KEY`];
  const model = env[`${prefix}_MODEL`];
  if (!baseUrl || !apiKey || !model) return null;
  return { name: prefix.toLowerCase(), baseUrl, apiKey, model };
}

/** Pull the first JSON object out of a reply (some models wrap JSON in prose or code fences). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(text.slice(start, end + 1));
}

export async function chatJson<T>(
  cfg: LlmConfig,
  schema: z.ZodType<T>,
  system: string,
  user: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LlmResult<T>> {
  const started = Date.now();
  const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 90_000),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) throw new LlmError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, cfg.name);
  const body = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = body.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw);
  } catch (e) {
    throw new LlmError(`unparseable reply: ${(e as Error).message}`, cfg.name, raw);
  }
  const checked = schema.safeParse(parsed);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new LlmError(`schema violation at ${issue?.path.join(".")}: ${issue?.message}`, cfg.name, raw);
  }
  return {
    data: checked.data,
    raw,
    latencyMs,
    model: body.model ?? cfg.model,
    usage: { promptTokens: body.usage?.prompt_tokens, completionTokens: body.usage?.completion_tokens },
  };
}
