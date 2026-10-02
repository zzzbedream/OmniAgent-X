// OpenAI-compatible chat client. DeepSeek (https://api.deepseek.com) exposes this shape, and so do most
// other providers. Base URL, key and model ids come from configuration, never from code, so the provider
// can change without a release (see docs/VERIFIED_FACTS.md for what was checked).
import type { z } from "zod";

export type LlmConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxTokens?: number;
};

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

/** Replies stay short (a plan or a mandate), so this cap only guards against runaway output. */
const DEFAULT_MAX_TOKENS = 2048;
/** DeepSeek documents that JSON mode "may occasionally return empty content": one retry covers it. */
const EMPTY_REPLY_RETRIES = 1;

export type LlmRoles = { parser: LlmConfig; planner: LlmConfig };

/**
 * One provider for both pipeline roles: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, plus optional
 * LLM_PLANNER_MODEL (a stronger model for sizing) and LLM_MAX_TOKENS.
 */
export function llmRolesFromEnv(
  env: Record<string, string | undefined>,
): { roles: LlmRoles; missing: [] } | { roles: null; missing: string[] } {
  const baseUrl = env.LLM_BASE_URL;
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL;
  const maxTokens = env.LLM_MAX_TOKENS === undefined ? undefined : Number(env.LLM_MAX_TOKENS);
  const missing = [
    !baseUrl && "LLM_BASE_URL",
    !apiKey && "LLM_API_KEY",
    !model && "LLM_MODEL",
    maxTokens !== undefined && !(Number.isInteger(maxTokens) && maxTokens > 0) && "LLM_MAX_TOKENS (positive integer)",
  ].filter((m): m is string => typeof m === "string");
  if (missing.length > 0 || !baseUrl || !apiKey || !model) return { roles: null, missing };
  const base = { baseUrl, apiKey, maxTokens };
  return {
    roles: {
      parser: { ...base, name: "parser", model },
      planner: { ...base, name: "planner", model: env.LLM_PLANNER_MODEL || model },
    },
    missing: [],
  };
}

/** Pull the first JSON object out of a reply (some models wrap JSON in prose or code fences). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(text.slice(start, end + 1));
}

type ChatBody = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

async function postChat(cfg: LlmConfig, system: string, user: string, fetchImpl: typeof fetch): Promise<ChatBody> {
  const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 90_000),
  });
  if (!res.ok) throw new LlmError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, cfg.name);
  return (await res.json()) as ChatBody;
}

const contentOf = (body: ChatBody) => body.choices?.[0]?.message?.content ?? "";

export async function chatJson<T>(
  cfg: LlmConfig,
  schema: z.ZodType<T>,
  system: string,
  user: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LlmResult<T>> {
  const started = Date.now();
  let body = await postChat(cfg, system, user, fetchImpl);
  for (let attempt = 0; attempt < EMPTY_REPLY_RETRIES && contentOf(body).trim() === ""; attempt++) {
    body = await postChat(cfg, system, user, fetchImpl);
  }
  // Wall time including any retry: that is what the user waits for.
  const latencyMs = Date.now() - started;
  const raw = contentOf(body);
  if (raw.trim() === "") throw new LlmError(`empty reply after ${EMPTY_REPLY_RETRIES + 1} attempts`, cfg.name);
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
