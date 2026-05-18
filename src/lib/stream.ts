// src/lib/stream.ts
import { calculateCostUsd, type ModelDef } from "./cost";

export type StreamEvent =
  | { type: "chunk";  content: string }
  | { type: "done";   usage: { inputTokens: number; outputTokens: number; costUsd: number } }
  | { type: "error";  message: string; status?: number };

interface StreamParams {
  apiKey:       string;
  openRouterId: string;        // e.g. "anthropic/claude-sonnet-4-5"
  messages:     Array<{ role: string; content: unknown }>;
  onChunk:      (text: string) => void;
  onDone:       (usage: Extract<StreamEvent, { type: "done" }>["usage"]) => void;
  onError:      (msg: string, status?: number) => void;
  signal?:      AbortSignal;
  model:        ModelDef;      // for cost calculation post-stream
}

export async function streamMessage(params: StreamParams): Promise<void> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${params.apiKey}`,
      "HTTP-Referer":  "https://github.com/rahulmohan/cogninode",
      "X-Title":       "cogninode beta",
    },
    body: JSON.stringify({
      model:          params.openRouterId,
      messages:       [
        {
          role: "system",
          content:
            "You are a helpful assistant in cogninode, a tree-shaped AI chat. " +
            "The user is working in a branch of a larger conversation. " +
            "Be precise and concise. Avoid preamble.",
        },
        ...params.messages,
      ],
      stream:         true,
      stream_options: { include_usage: true },
      max_tokens:     4096,
    }),
    signal: params.signal ?? null,
  });

  if (!response.ok) {
    const body = await response.text();
    // OpenRouter returns structured errors — parse for better messages
    let message = `HTTP ${response.status}`;
    try {
      const err = JSON.parse(body);
      message = err.error?.message ?? message;
      // Common errors
      if (response.status === 401) message = "Invalid API key. Check Settings.";
      if (response.status === 402) message = "Insufficient OpenRouter credits.";
      if (response.status === 429) message = "Rate limited. Wait a moment.";
    } catch { /* use raw body */ }
    params.onError(message, response.status);
    return;
  }

  const reader  = response.body!.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";
  let   inputTokens  = 0;
  let   outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const line = event.split("\n").find(l => l.startsWith("data: "));
        if (!line) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;

        try {
          const parsed = JSON.parse(raw);
          const delta  = parsed.choices?.[0]?.delta?.content;
          if (delta) params.onChunk(delta);
          if (parsed.usage) {
            inputTokens  = parsed.usage.prompt_tokens     ?? 0;
            outputTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch { /* skip malformed */ }
      }
    }

    params.onDone({
      inputTokens,
      outputTokens,
      costUsd: calculateCostUsd(inputTokens, outputTokens, params.model),
    });
  } finally {
    reader.releaseLock();
  }
}
