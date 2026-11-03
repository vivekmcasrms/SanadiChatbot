export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * OpenAI-compatible chat call. Providers (openai, azure, custom) share
 * the same wire format with different base URL and credentials.
 */
async function openAiCompatibleChat(
  baseUrl: string,
  headers: Record<string, string>,
  config: ProviderConfig,
  req: LlmRequest,
): Promise<LlmResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toWire(req.messages),
    temperature: req.temperature ?? config.temperature,
    max_tokens: req.maxOutputTokens ?? config.maxOutputTokens,
  };
  // Fast mode: priority serving cuts provider queue and first-token time
  // without changing the model, its output, or any verification step. Only
  // set on models that actually support the tier â€” elsewhere it is ignored
  // and would still bill at the standard rate.
  if (PRIORITY_CAPABLE.test(config.model)) body["service_tier"] = "priority";
  if (req.reasoningEffort) body["reasoning_effort"] = req.reasoningEffort;

  if (req.tools?.length) {
    body["tools"] = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body["tool_choice"] = "auto";
  }
  if (req.jsonSchema) {
    body["response_format"] = {
      type: "json_schema",
      json_schema: { name: req.jsonSchema.name, strict: false, schema: req.jsonSchema.schema },
    };
  }

  const streaming = typeof req.onToken === "function";
  if (streaming) {
    body["stream"] = true;
    body["stream_options"] = { include_usage: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? config.timeoutMs);
  let res: Response;
  try {
    const endpoint = new URL(baseUrl);
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, "")
      .replace(/\/(?:chat\/completions|audio\/speech)$/i, "") + "/chat/completions";
    endpoint.hash = "";
    res = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderUnavailableError(
      error instanceof Error ? error.message : "Model provider request failed",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Gateway rejections are operational signal, not noise: without the body
    // a 400 is indistinguishable from an outage in the telemetry.
    console.error("[model] provider error", {
      status: res.status,
      model: config.model,
      // Roles only â€” message content is student data and never logged.
      // Roles only â€” message content is student data and never logged.
      roles: (body["messages"] as { role: string }[] | undefined)?.map((m) => m.role).join(">"),
      detail: detail.slice(0, 400),
    });
    throw new ProviderUnavailableError(
      `Model provider returned ${res.status}: ${detail.slice(0, 300)}`,
      res.status,
    );
  }


  if (streaming && res.body) {
    return readStream(res, config, req.onToken!, started);
  }

  const json = (await res.json()) as {
    choices?: ChatChoice[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = json.choices?.[0]?.message;
  const toolCalls: LlmToolCall[] = (choice?.tool_calls ?? []).map((c) => {
    let args: Record<string, unknown> = {};
    try {
      args = c.function.arguments ? (JSON.parse(c.function.arguments) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    return { id: c.id, name: c.function.name, args };
  });

  return {
    text: choice?.content ?? "",
    toolCalls,
    model: config.model,
    provider: config.provider,
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    providerDurationMs: Date.now() - started,
    providerFirstTokenMs: null,
  };
}

/* ------------------------------------------------------------------ */
/* Native Google Gemini adapter                                        */
/* ------------------------------------------------------------------ */

function providerUrl(config: ProviderConfig): string {
  const url = config.apiUrl?.trim();
  if (!url) throw new ProviderUnavailableError("AI provider URL is not configured in ai_settings.api_url");
  return url.replace(/\/$/, "");
}

/** Thinking budget in tokens. Routine turns explain verified results, so the
 *  default is zero thinking â€” that is where the first-token saving comes from. */
const THINKING_BUDGET: Record<NonNullable<LlmRequest["reasoningEffort"]>, number> = {
  none: 0,
  low: 512,
  medium: 2048,
  high: 8192,
};

/** Gemini rejects JSON-Schema keywords it does not implement. */
function geminiSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(geminiSchema);
  if (!input || typeof input !== "object") return input;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (["additionalProperties", "$schema", "default", "examples", "const", "format"].includes(key)) {
      continue;
    }
    out[key] = geminiSchema(raw);
  }
  return out;
}

type GeminiPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } };
type GeminiChunk = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

/** Maps the provider-independent transcript onto Gemini's contents format. */
function toGemini(messages: LlmMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();
  const contents: Record<string, unknown>[] = [];
  // Gemini identifies a tool result by the FUNCTION NAME, not by a call id.
  // Resolve each tool message back to the name of the call that produced it.
  const nameById = new Map<string, string>();
  for (const m of messages) {
    for (const call of m.toolCalls ?? []) {
      if (call.id) nameById.set(call.id, call.name);
    }
  }
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      let parsed: unknown = m.content;
      try {
        parsed = JSON.parse(m.content);
      } catch {
        /* plain-text tool output */
      }
      const id = m.toolCallId ?? "";
      const name =
        nameById.get(id) ||
        // Fallback for ids minted as `call_<name>_<index>`.
        id.replace(/^call_/, "").replace(/_\d+$/, "") ||
        "tool";
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name,
              response: { result: parsed },
            },
          },
        ],
      });
      continue;
    }

    if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content?.trim()) parts.push({ text: m.content });
      for (const call of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      if (!parts.length) continue;
      contents.push({ role: "model", parts });
      continue;
    }
    contents.push({ role: "user", parts: [{ text: m.content }] });
  }
  return { system, contents };
}

function collectGemini(
  chunk: GeminiChunk,
  sink: { text: string; calls: LlmToolCall[]; prompt: number; completion: number },
  onToken?: (delta: string) => void,
) {
  if (chunk.usageMetadata) {
    sink.prompt = chunk.usageMetadata.promptTokenCount ?? sink.prompt;
    sink.completion = chunk.usageMetadata.candidatesTokenCount ?? sink.completion;
  }
  for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
    if (part.text) {
      sink.text += part.text;
      onToken?.(part.text);
    }
    if (part.functionCall?.name) {
      sink.calls.push({
        id: `call_${part.functionCall.name}_${sink.calls.length}`,
        name: part.functionCall.name,
        args: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    }
  }
}

async function geminiChat(config: ProviderConfig, req: LlmRequest): Promise<LlmResult> {
  const key = config.apiKey || process.env["GEMINI_API_KEY"];
  if (!key) throw new ProviderUnavailableError("GEMINI_API_KEY is not configured");

  const started = Date.now();
  const { system, contents } = toGemini(req.messages);
  const effort = req.reasoningEffort ?? "none";
  const generationConfig: Record<string, unknown> = {
    temperature: req.temperature ?? config.temperature,
    maxOutputTokens: req.maxOutputTokens ?? config.maxOutputTokens,
    thinkingConfig: { thinkingBudget: THINKING_BUDGET[effort] },
  };
  if (req.jsonSchema) {
    generationConfig["responseMimeType"] = "application/json";
    generationConfig["responseSchema"] = geminiSchema(req.jsonSchema.schema);
  }
  const body: Record<string, unknown> = { contents, generationConfig };
  if (system) body["systemInstruction"] = { parts: [{ text: system }] };
  if (req.tools?.length) {
    body["tools"] = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: geminiSchema(t.parameters),
        })),
      },
    ];
  }

  const streaming = typeof req.onToken === "function";
  const model = config.model.replace(/^google\//, "");
  const base = providerUrl(config);
  const url = streaming
    ? `${base}/models/${model}:streamGenerateContent?alt=sse`
    : `${base}/models/${model}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? config.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderUnavailableError(
      error instanceof Error ? error.message : "Gemini request failed",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Status and model only â€” never the student's message.
    console.error("[model] gemini error", { status: res.status, model, detail: detail.slice(0, 400) });
    throw new ProviderUnavailableError(`Gemini returned ${res.status}`, res.status);
  }

  const sink = { text: "", calls: [] as LlmToolCall[], prompt: 0, completion: 0 };
  let firstTokenMs: number | null = null;

  if (streaming && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(payload) as GeminiChunk;
        } catch {
          continue;
        }
        collectGemini(chunk, sink, (delta) => {
          if (firstTokenMs == null) firstTokenMs = Date.now() - started;
          req.onToken!(delta);
        });
      }
    }
  } else {
    collectGemini((await res.json()) as GeminiChunk, sink);
  }

  return {
    text: sink.text,
    toolCalls: sink.calls,
    model: config.model,
    provider: config.provider,
    promptTokens: sink.prompt,
    completionTokens: sink.completion,
    providerDurationMs: Date.now() - started,
    providerFirstTokenMs: firstTokenMs,
  };
}

/* ------------------------------------------------------------------ */
/* Back-pressure: bounded retries + a simple circuit breaker           */
/* ------------------------------------------------------------------ */

/** Per provider, so one failing engine never blocks its own fallback. */
const breakers = new Map<string, { failures: number; openUntil: number }>();
function breakerFor(provider: string) {
  let state = breakers.get(provider);
  if (!state) {
    state = { failures: 0, openUntil: 0 };
    breakers.set(provider, state);
  }
  return state;
}
/** Terminal statuses are never retried; 429/5xx get one bounded retry. */
const RETRYABLE = (status?: number) => status === 429 || (status != null && status >= 500);

export function providerBreakerState() {
  const states = [...breakers.values()];
  const openUntil = states.reduce((max, s) => Math.max(max, s.openUntil), 0);
  return {
    open: Date.now() < openUntil,
    failures: states.reduce((sum, s) => sum + s.failures, 0),
    openUntil,
  };
}

async function llmChatOnce(config: ProviderConfig, req: LlmRequest): Promise<LlmResult> {
  switch (config.provider) {
    // Legacy provider id kept for existing DB settings rows.
    case "lovable":
    case "openai": {
      const key =
        config.apiKey ||
        process.env["OPENAI_API_KEY"] ||
        process.env["CUSTOM_LLM_API_KEY"];
      if (!key) throw new ProviderUnavailableError("OPENAI_API_KEY is not configured");
      return openAiCompatibleChat(
        providerUrl(config),
        { Authorization: `Bearer ${key}` },
        config,
        req,
      );
    }
    case "azure": {
      const key = config.apiKey || process.env["AZURE_OPENAI_API_KEY"];
      const endpoint = providerUrl(config);
      if (!key || !endpoint) throw new ProviderUnavailableError("Azure OpenAI is not configured");
      return openAiCompatibleChat(endpoint.replace(/\/$/, ""), { "api-key": key }, config, req);
    }
    case "gemini":
    case "google":
      return geminiChat(config, req);
    case "anthropic": {
      const key = config.apiKey || process.env["ANTHROPIC_API_KEY"];
      if (!key) throw new ProviderUnavailableError("ANTHROPIC_API_KEY is not configured");
      return openAiCompatibleChat(
        providerUrl(config),
        { "x-api-key": key, "anthropic-version": "2023-06-01" },
        config,
        req,
      );
    }
    case "ollama":
      return openAiCompatibleChat(providerUrl(config), {}, config, req);
    case "custom": {
      const base = providerUrl(config);
      const key = process.env["CUSTOM_LLM_API_KEY"];
      return openAiCompatibleChat(
        base.replace(/\/$/, ""),
        key ? { Authorization: `Bearer ${key}` } : {},
        config,
        req,
      );
    }
    default:
      throw new ProviderUnavailableError(`Unknown model provider "${config.provider}"`);
  }
}

/** One attempt plus one bounded retry for transient failures on one provider. */
async function llmChatWithRetry(config: ProviderConfig, req: LlmRequest): Promise<LlmResult> {
  const state = breakerFor(config.provider);
  if (Date.now() < state.openUntil) {
    throw new ProviderUnavailableError("Model provider temporarily unavailable (circuit open)", 503);
  }
  try {
    const result = await llmChatOnce(config, req);
    state.failures = 0;
    return result;
  } catch (error) {
    const status = error instanceof ProviderUnavailableError ? error.status : undefined;
    if (RETRYABLE(status)) {
      await new Promise((r) => setTimeout(r, status === 429 ? 1200 : 500));
      try {
        const result = await llmChatOnce(config, req);
        state.failures = 0;
        return result;
      } catch (retryError) {
        state.failures += 1;
        if (state.failures >= 5) state.openUntil = Date.now() + 30_000;
        throw retryError;
      }
    }
    if (status == null || status >= 500) {
      state.failures += 1;
      if (state.failures >= 5) state.openUntil = Date.now() + 30_000;
    }
    throw error;
  }
}

/**
 * Public entry point. Bounded retry and a per-provider circuit breaker keep a
 * failing provider from being hammered, and a configured fallback provider
 * answers when the primary is unavailable â€” never to change a successful
 * answer, only when the primary produced nothing at all.
 */
export async function llmChat(config: ProviderConfig, req: LlmRequest): Promise<LlmResult> {
  // Once a token has reached the browser, switching providers would duplicate
  // visible text, so a partially streamed turn is never retried elsewhere.
  let emitted = false;
  const guarded: LlmRequest = req.onToken
    ? {
        ...req,
        onToken: (delta: string) => {
          emitted = true;
          req.onToken!(delta);
        },
      }
    : req;

  try {
    return await llmChatWithRetry(config, guarded);
  } catch (error) {
    const fallbackProvider = config.fallbackProvider;
    const sameProvider = !fallbackProvider || fallbackProvider === config.provider;
    if (emitted || sameProvider) throw error;

    console.warn("[model] falling back", {
      from: config.provider,
      to: fallbackProvider,
      status: error instanceof ProviderUnavailableError ? error.status : undefined,
    });
    const result = await llmChatWithRetry(
      {
        ...config,
        provider: fallbackProvider,
        model: config.fallbackModel || config.model,
        fallbackProvider: null,
        fallbackModel: null,
      },
      guarded,
    );
    return { ...result, fallbackUsed: true, fallbackFrom: config.provider };
  }
}
