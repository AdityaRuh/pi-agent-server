/**
 * HTTP+SSE client to pi-sdk-runtime.
 *
 * Opens a POST /prompt request, parses the SSE response line by line, and
 * surfaces each event to the caller via an async iterator. The caller (the
 * /chat route) decides which raw events to translate and forward.
 *
 * Uses native fetch + ReadableStream — no extra deps.
 */

import { env } from "@/lib/env";

export interface PromptStreamInput {
  conversationId: string;
  message: string;
  signal?: AbortSignal;
}

export interface SseEvent {
  /** SSE event name (the `event:` line). */
  event: string;
  /** Parsed JSON payload, or the raw string if not JSON. */
  data: unknown;
  /** SSE id, if present. */
  id?: string;
}

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${env.internalSharedToken}`,
    "content-type": "application/json",
  };
}

/**
 * AsyncIterable over the SSE events produced by pi-sdk-runtime.
 * Cleans up the connection if the consumer breaks out of the loop.
 */
export async function* streamPrompt(input: PromptStreamInput): AsyncGenerator<SseEvent> {
  const res = await fetch(`${env.piSdkRuntimeUrl}/prompt`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      conversationId: input.conversationId,
      message: input.message,
    }),
    signal: input.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`pi-sdk-runtime /prompt failed: ${res.status} ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    else if (line.startsWith("id:")) id = line.slice(3).trim();
  }

  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // not JSON — leave as string
  }
  return { event, data, id };
}

// ── Plain JSON RPC helpers (interrupt / approval / ask-user) ────────────────

export async function postInterrupt(conversationId: string): Promise<void> {
  await fetch(`${env.piSdkRuntimeUrl}/interrupt`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ conversationId }),
  });
}

export async function postAskUserAnswer(input: {
  conversationId: string;
  askId: string;
  answer: string;
  selected?: string;
}): Promise<void> {
  await fetch(`${env.piSdkRuntimeUrl}/ask-user/answer`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

export async function postApprovalAnswer(input: {
  conversationId: string;
  approvalId: string;
  decision: "approve" | "reject" | "cancel";
  reason?: string;
}): Promise<void> {
  await fetch(`${env.piSdkRuntimeUrl}/approval/answer`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

export async function getRuntimeStatus(): Promise<unknown> {
  const res = await fetch(`${env.piSdkRuntimeUrl}/status`, {
    method: "GET",
    headers: { authorization: `Bearer ${env.internalSharedToken}` },
  });
  return res.json();
}

// ── steer / followUp ────────────────────────────────────────────────────────

export async function postSteer(input: {
  conversationId: string;
  text: string;
}): Promise<Response> {
  return fetch(`${env.piSdkRuntimeUrl}/steer`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

export async function postFollowUp(input: {
  conversationId: string;
  text: string;
}): Promise<Response> {
  return fetch(`${env.piSdkRuntimeUrl}/follow-up`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

// ── model + thinking control ────────────────────────────────────────────────

export async function postModel(input: {
  conversationId: string;
  modelId?: string;
  provider?: string;
}): Promise<Response> {
  return fetch(`${env.piSdkRuntimeUrl}/model`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

export async function postThinkingLevel(input: {
  conversationId: string;
  level?: string;
}): Promise<Response> {
  return fetch(`${env.piSdkRuntimeUrl}/thinking-level`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}
