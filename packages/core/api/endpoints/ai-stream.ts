import { z } from "zod";
import {
  AiCitationSchema,
  AiMessageSchema,
  AiProposalSchema,
  AskUniStreamUsageSchema,
  type AiCitation,
  type AiMessage,
  type AiProposal,
  type AiStreamUsage,
  type AskUniInput,
} from "../../types/ai";
import { ApiError, requestStream } from "../http";
import { parseWithFallback } from "../schema";

export type AskUniStreamEvent =
  | { type: "run"; runId: string; conversationId: string }
  | { type: "step"; round: number; phase: "tool" | "retry" | (string & {}); tool: string; label: string; counts: Record<string, number> }
  | { type: "delta"; text: string }
  | { type: "proposal"; proposals: AiProposal[] }
  | { type: "citations"; citations: AiCitation[] }
  | { type: "sources"; sources: AiCitation[] }
  | { type: "followups"; followups: string[] }
  | { type: "title"; conversationId: string; title: string }
  | { type: "done"; message: AiMessage; usage: AiStreamUsage }
  | { type: "error"; code: string };

// Lenient wire shapes; each maps to one event. A frame that fails its schema is skipped.
const SCHEMAS: Record<string, (raw: unknown) => AskUniStreamEvent | null> = {
  run: (raw) => {
    const s = z.object({ run_id: z.string().catch(""), conversation_id: z.string() });
    const r = parseWithFallback<z.infer<typeof s> | null>(raw, s, null, { endpoint: "ai.askStream:run" });
    return r && { type: "run", runId: r.run_id, conversationId: r.conversation_id };
  },
  step: (raw) => {
    const s = z.object({
      round: z.number(),
      phase: z.string(),
      tool: z.string().catch(""),
      label: z.string().catch(""),
      counts: z.record(z.string(), z.number()).catch({}),
    });
    const r = parseWithFallback<z.infer<typeof s> | null>(raw, s, null, { endpoint: "ai.askStream:step" });
    return r && { type: "step", ...r };
  },
  delta: (raw) => {
    const s = z.object({ text: z.string() });
    const r = parseWithFallback<z.infer<typeof s> | null>(raw, s, null, { endpoint: "ai.askStream:delta" });
    return r && { type: "delta", text: r.text };
  },
  proposal: (raw) => {
    const s = z.object({ proposals: z.array(AiProposalSchema) });
    const r = parseWithFallback<{ proposals: AiProposal[] } | null>(raw, s, null, { endpoint: "ai.askStream:proposal" });
    return r && { type: "proposal", proposals: r.proposals };
  },
  citations: (raw) => {
    const s = z.object({ citations: z.array(AiCitationSchema) });
    const r = parseWithFallback<z.infer<typeof s> | null>(raw, s, null, { endpoint: "ai.askStream:citations" });
    return r && { type: "citations", citations: r.citations };
  },
  sources: (raw) => {
    const s = z.object({ sources: z.array(AiCitationSchema) });
    const r = parseWithFallback<z.infer<typeof s> | null>(raw, s, null, { endpoint: "ai.askStream:sources" });
    return r && { type: "sources", sources: r.sources };
  },
  followups: (raw) => {
    const s = z.object({ followups: z.array(z.string()) });
    const r = parseWithFallback<z.infer<typeof s> | null>(raw, s, null, { endpoint: "ai.askStream:followups" });
    return r && { type: "followups", followups: r.followups };
  },
  title: (raw) => {
    const s = z.object({ conversation_id: z.string(), title: z.string().catch("") });
    const r = parseWithFallback<z.infer<typeof s> | null>(raw, s, null, { endpoint: "ai.askStream:title" });
    return r && { type: "title", conversationId: r.conversation_id, title: r.title };
  },
  done: (raw) => {
    const s = z.object({
      message: AiMessageSchema,
      usage: AskUniStreamUsageSchema.catch({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }),
    });
    const r = parseWithFallback<{ message: AiMessage; usage: AiStreamUsage } | null>(raw, s, null, {
      endpoint: "ai.askStream:done",
    });
    return r && { type: "done", message: r.message, usage: r.usage };
  },
  error: (raw) => {
    const s = z.object({ code: z.string() });
    const r = parseWithFallback<z.infer<typeof s> | null>(raw, s, null, { endpoint: "ai.askStream:error" });
    return r && { type: "error", code: r.code };
  },
};

function toEvent(name: string, data: string): AskUniStreamEvent | null {
  const parse = SCHEMAS[name];
  if (!parse) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  return parse(raw);
}

/**
 * POST the question and read the SSE answer, calling onEvent per well-formed
 * event. Refusals before streaming reject with the same ApiError as askUni.
 * Resolves when the stream ends, with or without a done/error event; abort
 * rejects with the fetch AbortError and stops delivery at once.
 */
export async function askUniStream(
  wsId: string,
  body: AskUniInput,
  opts: { signal?: AbortSignal; onEvent: (e: AskUniStreamEvent) => void },
): Promise<void> {
  const { signal, onEvent } = opts;
  const res = await requestStream(`/api/v1/workspaces/${wsId}/ai/ask/stream`, { method: "POST", body, signal });
  if (!(res.headers.get("Content-Type") ?? "").startsWith("text/event-stream") || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    throw new ApiError("", "internal", res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abortError = () => signal?.reason ?? new DOMException("Aborted", "AbortError");

  const dispatch = (frame: string) => {
    let name = "";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") name = value;
      else if (field === "data") data.push(value);
    }
    if (!name || data.length === 0) return;
    const event = toEvent(name, data.join("\n"));
    if (event && !signal?.aborted) onEvent(event);
  };

  // Cancelling the reader wakes a read() that is waiting on a quiet stream.
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
      if (done) break;
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
