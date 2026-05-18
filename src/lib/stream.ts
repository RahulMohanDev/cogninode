// src/lib/stream.ts
// OpenRouter streaming via fetch + eventsource-parser. We feed every chunk
// the fetch reader hands us into a single SSE parser that emits one event
// per completed SSE record — robust against partial lines, multi-line data,
// retry hints, and CRLF newlines that a hand-rolled split-on-"\n\n" parser
// would miss.

import { createParser, type EventSourceMessage } from "eventsource-parser";
import { calculateCostUsd, type ModelDef } from "./cost";

export type StreamEvent =
  | { type: "chunk";  content: string }
  | { type: "done";   usage: { inputTokens: number; outputTokens: number; costUsd: number } }
  | { type: "error";  message: string; status?: number };

interface StreamParams {
  apiKey:       string;
  openRouterId: string;        // e.g. "anthropic/claude-sonnet-4.5"
  messages:     Array<{ role: string; content: unknown }>;
  onChunk:      (text: string) => void;
  onDone:       (usage: Extract<StreamEvent, { type: "done" }>["usage"]) => void;
  onError:      (msg: string, status?: number) => void;
  signal?:      AbortSignal;
  model:        ModelDef;      // for cost calculation post-stream
}

export async function streamMessage(params: StreamParams): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${params.apiKey}`,
        "HTTP-Referer":  "https://github.com/rahulmohan/cogninode",
        "X-Title":       "cogninode beta",
      },
      body: JSON.stringify({
        model:          params.openRouterId,
        messages: [
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
  } catch (err) {
    // Network-level failure (offline, DNS, CORS-preflight rejected, etc.)
    if (err instanceof DOMException && err.name === "AbortError") return;
    params.onError(err instanceof Error ? err.message : String(err));
    return;
  }

  if (!response.ok) {
    const body = await response.text();
    // OpenRouter returns structured errors — parse for a better message.
    let message = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch { /* keep HTTP fallback */ }
    if (response.status === 401) message = "Invalid API key. Check Settings.";
    if (response.status === 402) message = "Insufficient OpenRouter credits.";
    if (response.status === 429) message = "Rate limited. Wait a moment.";
    params.onError(message, response.status);
    return;
  }

  if (!response.body) {
    params.onError("OpenRouter returned an empty response body.");
    return;
  }

  let inputTokens  = 0;
  let outputTokens = 0;

  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      const raw = event.data;
      if (!raw || raw === "[DONE]") return;
      try {
        const parsed = JSON.parse(raw) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?:   { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) params.onChunk(delta);
        if (parsed.usage) {
          inputTokens  = parsed.usage.prompt_tokens     ?? inputTokens;
          outputTokens = parsed.usage.completion_tokens ?? outputTokens;
        }
      } catch {
        // Some OpenRouter SSE comments arrive as `: OPENROUTER PROCESSING`
        // and similar non-JSON events — ignore them silently.
      }
    },
    onError: (err) => {
      // The parser surfaces its own errors (malformed frames); log but keep
      // reading — most real-world streams recover from a single bad frame.
      console.warn("SSE parse error:", err);
    },
  });

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` makes TextDecoder hold incomplete multi-byte
      // sequences until the next chunk completes them.
      parser.feed(decoder.decode(value, { stream: true }));
    }
    // Flush the decoder so any trailing bytes are surfaced before we call
    // onDone — otherwise the last token can be lost.
    const tail = decoder.decode();
    if (tail) parser.feed(tail);

    params.onDone({
      inputTokens,
      outputTokens,
      costUsd: calculateCostUsd(inputTokens, outputTokens, params.model),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    params.onError(err instanceof Error ? err.message : String(err));
  } finally {
    reader.releaseLock();
  }
}
