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

/** A web-search source surfaced by OpenRouter's `web` plugin as a
 *  `url_citation` annotation on the assistant message. */
export interface Citation {
  url:      string;
  title?:   string;
  content?: string;
}

interface StreamParams {
  apiKey:       string;
  openRouterId: string;        // e.g. "anthropic/claude-sonnet-4.5"
  messages:     Array<{ role: string; content: unknown }>;
  /** Extra system context appended to the base system prompt (graph-RAG
   *  retrieval block). Concatenated rather than sent as a second system
   *  message — some OpenRouter providers mishandle multiple. */
  systemExtra?: string;
  onChunk:      (text: string) => void;
  /** Reasoning chunks from reasoning models (DeepSeek R1, Tencent HY3,
   *  OpenAI o1-style, etc). Separate from onChunk so the UI can render
   *  them in a distinct collapsible "Thinking" panel. */
  onReasoning?: (text: string) => void;
  /** Fires once after the stream completes when the `web` plugin returned
   *  any citations — deduplicated by url. */
  onCitations?: (citations: Citation[]) => void;
  onDone:       (usage: Extract<StreamEvent, { type: "done" }>["usage"]) => void;
  onError:      (msg: string, status?: number) => void;
  signal?:      AbortSignal;
  model:        ModelDef;      // for cost calculation post-stream
  /** When true, attach OpenRouter's `web` plugin so the model can run a
   *  paid web search for this request. */
  webSearch?:   boolean;
}

export async function streamMessage(params: StreamParams): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${params.apiKey}`,
        "HTTP-Referer":  "https://github.com/RahulMohanDev/cogninode",
        "X-Title":       "cogninode beta",
      },
      body: JSON.stringify({
        model:          params.openRouterId,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful, expert AI assistant. Answer the user's " +
              "request directly and substantively — do not ask the user to " +
              "restate or clarify their question unless it is genuinely " +
              "ambiguous; make reasonable assumptions and proceed. Use " +
              "markdown formatting (headings, lists, tables, fenced code " +
              "blocks) when it improves clarity. Be thorough when the " +
              "question is broad and concise when it is narrow." +
              (params.systemExtra ? "\n\n" + params.systemExtra : ""),
          },
          ...params.messages,
        ],
        stream:             true,
        stream_options:     { include_usage: true },
        // Reasoning models (DeepSeek R1, Tencent HY3, o1-style, etc) emit
        // their chain-of-thought into delta.reasoning. Without this opt-in,
        // some providers swallow it and the user sees an empty assistant
        // reply that still cost tokens.
        include_reasoning:  true,
        // 4096 used to be the cap — way too low for reasoning models that
        // can spend the entire budget thinking before any "answer" token.
        max_tokens:         16384,
        // OpenRouter's `web` plugin runs a paid web search for this request
        // (~$0.02 at 5 results) and streams back `url_citation` annotations.
        // We use the plugin rather than the `:online` model suffix so model
        // ids stay clean.
        ...(params.webSearch
          ? { plugins: [{ id: "web", max_results: 5 }] }
          : {}),
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
  let finishReason: string | null = null;
  let midStreamError: string | null = null;

  // url_citation annotations from the `web` plugin. They arrive across one
  // or more deltas (usually near the end of the stream) — accumulate and
  // dedupe by url so the last write per url wins.
  const citations = new Map<string, Citation>();

  type SseDataFrame = {
    choices?: Array<{
      delta?: {
        content?:           string | null;
        reasoning?:         string | null;
        reasoning_content?: string | null;
        annotations?:       Array<{
          type?:         string;
          url_citation?: {
            url?:     string;
            title?:   string;
            content?: string;
          };
        }>;
      };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; code?: number | string };
  };

  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      const raw = event.data;
      if (!raw || raw === "[DONE]") return;
      let parsed: SseDataFrame;
      try {
        parsed = JSON.parse(raw) as SseDataFrame;
      } catch {
        return; // malformed/non-JSON data payload — skip this frame
      }
      const choice = parsed.choices?.[0];
      const delta  = choice?.delta;
      if (delta) {
        // OpenRouter normalizes reasoning to `reasoning`; some upstream
        // providers leak the original `reasoning_content`. Handle both.
        const reasoning = delta.reasoning ?? delta.reasoning_content;
        if (typeof reasoning === "string" && reasoning && params.onReasoning) {
          params.onReasoning(reasoning);
        }
        if (typeof delta.content === "string" && delta.content) {
          params.onChunk(delta.content);
        }
        if (delta.annotations) {
          for (const ann of delta.annotations) {
            const cit = ann.url_citation;
            const url = cit?.url;
            if (!url) continue;
            const entry: Citation = { url };
            if (cit.title)   entry.title   = cit.title;
            if (cit.content) entry.content = cit.content;
            citations.set(url, entry);
          }
        }
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (parsed.usage) {
        inputTokens  = parsed.usage.prompt_tokens     ?? inputTokens;
        outputTokens = parsed.usage.completion_tokens ?? outputTokens;
      }
      if (parsed.error?.message) midStreamError = parsed.error.message;
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

    if (midStreamError !== null || finishReason === "error") {
      params.onError(midStreamError ?? "Provider returned a mid-stream error.");
      return;
    }

    // If the model burned the entire output budget and never finished its
    // answer, tell the user instead of leaving them confused by a half-
    // sentence (or empty) reply.
    if (finishReason === "length") {
      params.onChunk(
        "\n\n_(response hit max-tokens limit — bump the cap in src/lib/stream.ts if you need longer answers)_",
      );
    }

    if (citations.size > 0 && params.onCitations) {
      params.onCitations([...citations.values()]);
    }

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
