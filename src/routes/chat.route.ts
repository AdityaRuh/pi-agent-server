/**
 * The 6 endpoints the gateway calls. Each is a thin wrapper around the
 * sdk-client + event-formatter pair.
 *
 *   POST /chat              → start a run; SSE in the gateway's FE vocab
 *   GET  /resume            → re-attach to an in-flight run (stub for MVP)
 *   POST /stop              → abort the active run
 *   POST /approve           → forward an approval decision
 *   POST /ask-user/answer   → forward an ask-user answer
 *   GET  /status            → liveness + active conversation ids
 */

import { Elysia, t } from "elysia";
import { assertGatewayToken } from "@/lib/auth";
import { SSE_HEADERS, createSseChannel } from "@/lib/sse";
import { formatPiEvent } from "@/lib/event-formatter";
import {
  getRuntimeStatus,
  postApprovalAnswer,
  postAskUserAnswer,
  postInterrupt,
  streamPrompt,
} from "@/clients/sdk-client";

const nowIso = () => new Date().toISOString();

export const chatRoute = new Elysia({ name: "chat-routes" })
  // ── POST /chat ───────────────────────────────────────────────────────────
  .post(
    "/chat",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);

      const channel = createSseChannel();
      const conversationId = body.conversationId;

      channel.send("run_start", {
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
            signal: ac.signal,
          });

          for await (const sse of stream) {
            if (sse.event === "pi_event") {
              formatPiEvent(channel.send, { conversationId }, sse.data);
            } else if (sse.event === "run_start") {
              // Already emitted by us; drop the runtime's copy.
            } else if (sse.event === "agent_end") {
              channel.send("agent_end", {
                type: "agent_end",
                stop_reason: "completed",
                timestamp: nowIso(),
              });
            } else if (sse.event === "error") {
              channel.send("error", {
                ...(sse.data as object),
                timestamp: nowIso(),
              });
            } else {
              // Pass-through for ask_user_*, approval_required, etc.
              channel.send(sse.event, sse.data);
            }
          }
        } catch (err) {
          channel.send("error", {
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
      }),
    },
  )

  // ── GET /resume ──────────────────────────────────────────────────────────
  // MVP stub: returns a one-shot "no live stream" notice. Wire up Redis-
  // backed event replay in a follow-up PR if the platform needs it.
  .get(
    "/resume",
    ({ query, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      const channel = createSseChannel();
      channel.send("error", {
        message: "resume not implemented in MVP",
        conversationId: query.conversationId,
        timestamp: nowIso(),
      });
      channel.close();
      return new Response(channel.stream, { headers: SSE_HEADERS });
    },
    {
      query: t.Object({ conversationId: t.String({ minLength: 1 }) }),
    },
  )

  // ── POST /stop ───────────────────────────────────────────────────────────
  .post(
    "/stop",
    async ({ body, headers }) => {
      assertGatewayToken(headers as Record<string, string | undefined>);
      await postInterrupt(body.conversationId);
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

  // ── GET /status ──────────────────────────────────────────────────────────
  .get("/status", async ({ headers }) => {
    assertGatewayToken(headers as Record<string, string | undefined>);
    const runtimeStatus = await getRuntimeStatus().catch(() => ({ ok: false }));
    return { ok: true, runtime: runtimeStatus };
  });
