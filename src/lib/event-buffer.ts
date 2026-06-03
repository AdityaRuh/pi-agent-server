/**
 * In-memory per-conversation event buffer.
 *
 * Used by /chat to record every SSE event it forwards to the FE, and by
 * /resume to replay missed events when a client reconnects after a brief
 * disconnect.
 *
 * Buffer policy:
 *   - keyed by conversationId
 *   - ring of last N events per conversation (default 1000)
 *   - dropped when a new /chat starts for the same conversationId
 *     (i.e. each fresh run gets a fresh buffer)
 *   - in-memory only — process restart wipes everything
 *
 * For multi-replica deployments you'll want to swap this for Redis Streams
 * (xadd / xrange). The interface here is intentionally compatible.
 */

const MAX_EVENTS_PER_CONVERSATION = 1000;

interface BufferedEvent {
  /** Monotonic per-conversation event id (1, 2, 3, …). */
  eventId: number;
  /** SSE event name. */
  event: string;
  /** Already-stringified JSON payload. */
  data: string;
  /** ms since epoch. */
  ts: number;
}

interface ConversationBuffer {
  events: BufferedEvent[];
  nextEventId: number;
  /** True once the run has emitted agent_end / error. */
  closed: boolean;
}

const buffers = new Map<string, ConversationBuffer>();

export function startConversationBuffer(conversationId: string): void {
  buffers.set(conversationId, { events: [], nextEventId: 1, closed: false });
}

export function appendEvent(
  conversationId: string,
  event: string,
  data: unknown,
): number {
  let buf = buffers.get(conversationId);
  if (!buf) {
    buf = { events: [], nextEventId: 1, closed: false };
    buffers.set(conversationId, buf);
  }
  const eventId = buf.nextEventId++;
  buf.events.push({
    eventId,
    event,
    data: typeof data === "string" ? data : JSON.stringify(data),
    ts: Date.now(),
  });
  // Trim the head if we're over the cap.
  if (buf.events.length > MAX_EVENTS_PER_CONVERSATION) {
    buf.events.splice(0, buf.events.length - MAX_EVENTS_PER_CONVERSATION);
  }
  if (event === "agent_end" || event === "error") buf.closed = true;
  return eventId;
}

export function getEventsSince(
  conversationId: string,
  fromEventId: number,
): BufferedEvent[] {
  const buf = buffers.get(conversationId);
  if (!buf) return [];
  return buf.events.filter((e) => e.eventId > fromEventId);
}

export function isConversationClosed(conversationId: string): boolean {
  const buf = buffers.get(conversationId);
  return buf ? buf.closed : true;
}

export function conversationExists(conversationId: string): boolean {
  return buffers.has(conversationId);
}

export function clearConversation(conversationId: string): void {
  buffers.delete(conversationId);
}

export function summarizeBuffers(): {
  conversations: number;
  totalEvents: number;
} {
  let total = 0;
  for (const b of buffers.values()) total += b.events.length;
  return { conversations: buffers.size, totalEvents: total };
}
