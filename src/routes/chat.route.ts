/**
 * Public-facing chat endpoints the gateway calls.
 *
 *   POST /chat               → start a run; SSE in the gateway's FE vocab
 *   GET  /resume             → re-attach to an in-flight or recently-finished run
 *   POST /stop               → abort the active run
 *   POST /approve            → forward an approval decision
 *   POST /ask-user/answer    → forward an ask-user answer
 *   POST /steer              → inject extra context into a streaming run
 *   POST /follow-up          → queue a follow-up prompt for after the current turn
 *   POST /model              → switch model mid-conversation
 *   POST /thinking-level     → set or cycle the model's thinking depth
 *   GET  /status             → liveness + buffer summary + runtime status
 *
 * Events written to the gateway-facing SSE response are also appended to
 * an in-memory event buffer keyed by conversationId — that's what powers
 * /resume.
 */

import { Elysia, t } from "elysia";
import { assertGatewayToken } from "@/lib/auth";
import { SSE_HEADERS, createSseChannel, encodeSse } from "@/lib/sse";
import { formatPiEvent } from "@/lib/event-formatter";
import {
  getRuntimeStatus,
  postApprovalAnswer,
  postAskUserAnswer,
  postFollowUp,
  postInterrupt,
  postModel,
  postSteer,
  postThinkingLevel,
  streamPrompt,
} from "@/clients/sdk-client";
import {
  appendEvent,
  conversationExists,
  getEventsSince,
  isConversationClosed,
  startConversationBuffer,
  summarizeBuffers,
} from "@/lib/event-buffer";

const nowIso = () => new Date().toISOString();

export const chatRoute = new Elysia({ name: "chat-routes" })
  // ── POST /chat ───────────────────────────────────────────────────────────
  .post(
    "/chat",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);

      const conversationId = body.conversationId;
      startConversationBuffer(conversationId);

      const channel = createSseChannel();

      // Every event we forward to the client is also recorded in the buffer
      // so /resume can replay.
      const recordAndSend = (event: string, data: unknown) => {
        const id = appendEvent(conversationId, event, data);
        channel.send(event, data, String(id));
      };

      recordAndSend("run_start", {
        type: "run_start",
        conversationId,
        timestamp: nowIso(),
      });

      const ac = new AbortController();

      (async () => {
        try {
          const stream = streamPrompt({
            conversationId,
            message: body.message,
            ...(body.attachments && body.attachments.length > 0
              ? { attachments: body.attachments }
              : {}),
            signal: ac.signal,
          });

          for await (const sse of stream) {
            if (sse.event === "pi_event") {
              formatPiEvent(
                recordAndSend,
                { conversationId },
                sse.data,
              );
            } else if (sse.event === "run_start") {
              // Already emitted by us; drop the runtime's copy.
            } else if (sse.event === "agent_end") {
              recordAndSend("agent_end", {
                type: "agent_end",
                stop_reason: "completed",
                timestamp: nowIso(),
              });
            } else if (sse.event === "error") {
              recordAndSend("error", {
                ...(sse.data as object),
                timestamp: nowIso(),
              });
            } else {
              // Pass-through for ask_user_*, approval_required,
              // subagent_*, etc.
              recordAndSend(sse.event, sse.data);
            }
          }
        } catch (err) {
          recordAndSend("error", {
            message: err instanceof Error ? err.message : String(err),
            timestamp: nowIso(),
          });
        } finally {
          channel.close();
        }
      })();

      return new Response(channel.stream, { headers: SSE_HEADERS });
    },
    {
      body: t.Object({
        conversationId: t.String({ minLength: 1 }),
        message: t.String({ minLength: 1 }),
        attachments: t.Optional(t.Array(t.Object({
          url: t.String({ minLength: 1 }),
          mimeType: t.String({ minLength: 1 }),
          name: t.String({ minLength: 1 }),
          sizeBytes: t.Optional(t.Number({ minimum: 0 })),
        }))),
      }),
    },
  )

  // ── GET /resume ──────────────────────────────────────────────────────────
  // Replay all buffered events since `?fromEventId=N`. If the run is still
  // open, the response stays open and continues streaming live events.
  // If the run has already ended, the response replays + closes.
  .get(
    "/resume",
    ({ query, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);

      const conversationId = query.conversationId;
      const fromEventId = Number(query.fromEventId ?? 0) || 0;

      if (!conversationExists(conversationId)) {
        const channel = createSseChannel();
        channel.send("error", {
          message: "unknown conversationId",
          conversationId,
          timestamp: nowIso(),
        });
        channel.close();
        return new Response(channel.stream, { headers: SSE_HEADERS });
      }

      const missed = getEventsSince(conversationId, fromEventId);

      // Build a stream that replays buffered events then either closes
      // (if the run is done) or tails new events (if still active).
      const encoder = new TextEncoder();
      let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Replay missed events.
          for (const e of missed) {
            controller.enqueue(encoder.encode(encodeSse(e.event, e.data, String(e.eventId))));
          }

          if (isConversationClosed(conversationId)) {
            controller.close();
            return;
          }

          // Tail: poll the buffer every 250ms for new events while open.
          let lastSeenId = missed.length
            ? (missed[missed.length - 1]?.eventId ?? fromEventId)
            : fromEventId;
          const interval = setInterval(() => {
            if (closed) return;
            const fresh = getEventsSince(conversationId, lastSeenId);
            for (const e of fresh) {
              controller.enqueue(encoder.encode(encodeSse(e.event, e.data, String(e.eventId))));
              lastSeenId = e.eventId;
            }
            if (isConversationClosed(conversationId)) {
              clearInterval(interval);
              try {
                controller.close();
              } catch {}
              closed = true;
            }
          }, 250);
        },
        cancel() {
          closed = true;
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    },
    {
      query: t.Object({
        conversationId: t.String({ minLength: 1 }),
        fromEventId: t.Optional(t.String()),
      }),
    },
  )

  // ── POST /stop ───────────────────────────────────────────────────────────
  .post(
    "/stop",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      await postInterrupt(body.conversationId);
      appendEvent(body.conversationId, "agent_end", {
        type: "agent_end",
        stop_reason: "aborted",
        timestamp: nowIso(),
      });
      return { success: true, message: "stop requested" };
    },
    {
      body: t.Object({ conversationId: t.String({ minLength: 1 }) }),
    },
  )

  // ── POST /approve ────────────────────────────────────────────────────────
  .post(
    "/approve",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      await postApprovalAnswer({
        conversationId: body.conversationId,
        approvalId: body.approvalId,
        decision: body.decision,
        reason: body.reason,
      });
      return { ok: true };
    },
    {
      body: t.Object({
        conversationId: t.String({ minLength: 1 }),
        approvalId: t.String({ minLength: 1 }),
        decision: t.Union([
          t.Literal("approve"),
          t.Literal("reject"),
          t.Literal("cancel"),
        ]),
        reason: t.Optional(t.String()),
      }),
    },
  )

  // ── POST /ask-user/answer ────────────────────────────────────────────────
  .post(
    "/ask-user/answer",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      await postAskUserAnswer({
        conversationId: body.conversationId,
        askId: body.askId,
        answer: body.answer,
        selected: body.selected,
      });
      return { ok: true };
    },
    {
      body: t.Object({
        conversationId: t.String({ minLength: 1 }),
        askId: t.String({ minLength: 1 }),
        answer: t.String(),
        selected: t.Optional(t.String()),
      }),
    },
  )

  // ── POST /steer ──────────────────────────────────────────────────────────
  .post(
    "/steer",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      const upstream = await postSteer({
        conversationId: body.conversationId,
        text: body.text,
      });
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return { ok: false, reason: errText || `runtime returned ${upstream.status}` };
      }
      return { ok: true };
    },
    {
      body: t.Object({
        conversationId: t.String({ minLength: 1 }),
        text: t.String({ minLength: 1 }),
      }),
    },
  )

  // ── POST /follow-up ──────────────────────────────────────────────────────
  .post(
    "/follow-up",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      const upstream = await postFollowUp({
        conversationId: body.conversationId,
        text: body.text,
      });
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return { ok: false, reason: errText || `runtime returned ${upstream.status}` };
      }
      return { ok: true };
    },
    {
      body: t.Object({
        conversationId: t.String({ minLength: 1 }),
        text: t.String({ minLength: 1 }),
      }),
    },
  )

  // ── POST /model ──────────────────────────────────────────────────────────
  .post(
    "/model",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      const upstream = await postModel({
        conversationId: body.conversationId,
        modelId: body.modelId,
        provider: body.provider,
      });
      return upstream.json();
    },
    {
      body: t.Object({
        conversationId: t.String({ minLength: 1 }),
        modelId: t.Optional(t.String()),
        provider: t.Optional(t.String()),
      }),
    },
  )

  // ── POST /thinking-level ─────────────────────────────────────────────────
  .post(
    "/thinking-level",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      const upstream = await postThinkingLevel({
        conversationId: body.conversationId,
        level: body.level,
      });
      return upstream.json();
    },
    {
      body: t.Object({
        conversationId: t.String({ minLength: 1 }),
        level: t.Optional(t.String()),
      }),
    },
  )

  // ── GET /status ──────────────────────────────────────────────────────────
  .get("/status", async ({ headers }) => {
    assertGatewayToken(headers as Record<string, string | undefined>);
    const runtimeStatus = await getRuntimeStatus().catch(() => ({ ok: false }));
    return { ok: true, runtime: runtimeStatus, buffer: summarizeBuffers() };
  });
