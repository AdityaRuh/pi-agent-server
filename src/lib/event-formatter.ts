/**
 * Pi SDK events → gateway FE event vocabulary.
 *
 * pi-sdk-runtime forwards raw Pi SDK events under the SSE event name
 * `pi_event` (the payload is the AgentSessionEvent). This module decides
 * which FE event(s), if any, to emit for each raw event.
 *
 * Reference for the FE vocabulary:
 *   Ruh-agent-gateway/src/vm-client/openclawWs.ts (JSDoc at top of file)
 *
 * Reference for the rich Pi SDK event shapes:
 *   openclaw-builder-agent/src/lib/stream-formatter.ts (861 lines, full mapping)
 *
 * This MVP only covers the most common branches; extend as needed.
 */

const TRUNCATE_TOOL_OUTPUT_CHARS = 100;

const nowIso = () => new Date().toISOString();

type Emit = (event: string, data: unknown) => void;

/**
 * Translate a single raw Pi event into zero, one, or many FE events.
 * Unknown events are dropped silently (matches builder-agent's behaviour).
 */
export function formatPiEvent(
  emit: Emit,
  ctx: { conversationId: string },
  raw: unknown,
): void {
  const ev = raw as { type?: string; [k: string]: unknown };
  if (!ev || typeof ev.type !== "string") return;

  switch (ev.type) {
    case "message_update": {
      const inner = ev.assistantMessageEvent as
        | { type?: string; delta?: string; thinking?: string; sourceAgent?: string; delegationId?: string }
        | undefined;
      if (!inner) return;

      switch (inner.type) {
        case "text_start":
          emit("message_start", {
            type: "message_start",
            source_agent: inner.sourceAgent ?? "main",
            delegation_id: inner.delegationId ?? "",
            timestamp: nowIso(),
          });
          return;
        case "text_delta":
          emit("message_delta", {
            type: "message_delta",
            message_delta: inner.delta ?? "",
            source_agent: inner.sourceAgent ?? "main",
            delegation_id: inner.delegationId ?? "",
            timestamp: nowIso(),
          });
          return;
        case "text_end":
          emit("message_end", {
            type: "message_end",
            source_agent: inner.sourceAgent ?? "main",
            delegation_id: inner.delegationId ?? "",
            timestamp: nowIso(),
          });
          return;
        case "thinking_start":
          emit("thinking_start", { type: "thinking_start", timestamp: nowIso() });
          return;
        case "thinking_delta":
          emit("thinking_delta", {
            type: "thinking_delta",
            thinking_delta: inner.delta ?? "",
            timestamp: nowIso(),
          });
          return;
        case "thinking_end":
          emit("thinking_end", { type: "thinking_end", timestamp: nowIso() });
          return;
        default:
          return; // unknown inner type — drop
      }
    }

    case "tool_execution_start": {
      const t = ev as {
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
      };
      emit("tool_start", {
        type: "tool_start",
        tool_call_id: t.toolCallId ?? crypto.randomUUID(),
        tool_name: t.toolName ?? "unknown",
        args: t.args ?? {},
        timestamp: nowIso(),
      });
      return;
    }

    case "tool_execution_end": {
      const t = ev as {
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
        output?: unknown;
        isError?: boolean;
      };
      let outStr = typeof t.output === "string" ? t.output : JSON.stringify(t.output ?? "");
      if (outStr.length > TRUNCATE_TOOL_OUTPUT_CHARS && !t.isError) {
        outStr = outStr.slice(0, TRUNCATE_TOOL_OUTPUT_CHARS) + "…";
      }
      emit("tool_end", {
        type: "tool_end",
        tool_call_id: t.toolCallId ?? "",
        tool_name: t.toolName,
        args: t.args,
        output: outStr,
        is_error: t.isError === true,
        timestamp: nowIso(),
      });
      return;
    }

    // Ask-user and approval events are emitted by the proxy extensions in
    // pi-sdk-runtime under fixed event names — they arrive here pre-shaped.
    case "ask_user_start":
    case "ask_user_end":
    case "approval_required":
      emit(ev.type, { ...(ev as object), conversationId: ctx.conversationId });
      return;

    // Sub-agent events from the subagent.proxy extension.
    case "subagent_start":
    case "subagent_end":
      emit(ev.type, { ...(ev as object), conversationId: ctx.conversationId });
      return;
    case "subagent_event": {
      // Nested Pi SDK events from a child session — recursively translate
      // them so the FE can render nested progress with subagent_* names.
      const child = ev as {
        subagentId?: string;
        name?: string;
        event?: unknown;
      };
      const childEvent = child.event as { type?: string } | undefined;
      if (!childEvent) return;
      // Re-emit each child token/tool event with a subagent_ prefix so the
      // FE can distinguish parent vs. child streams.
      formatPiEvent(
        (innerName, innerData) => {
          emit(`subagent_${innerName}`, {
            ...(innerData as object),
            subagentId: child.subagentId,
            subagent_name: child.name,
          });
        },
        ctx,
        childEvent,
      );
      return;
    }

    // Usage / cost telemetry.
    case "usage_update":
    case "message_usage": {
      const u = ev as {
        usage?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
        };
        cost?: { total?: number; input?: number; output?: number };
        model?: string;
      };
      emit("usage", {
        type: "usage",
        usage: u.usage ?? {},
        cost: u.cost ?? {},
        model: u.model,
        timestamp: nowIso(),
      });
      return;
    }

    default:
      return; // unknown top-level event — drop
  }
}
