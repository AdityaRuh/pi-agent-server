/**
 * The SSE event vocabulary the **existing** Ruh-agent-gateway expects from
 * any chat runtime (OpenClaw, Hermes, PI). Documented in
 *   Ruh-agent-gateway/src/vm-client/openclawWs.ts (the JSDoc at the top).
 *
 * Keep this file in sync with that documentation. If it ever drifts, the
 * gateway → FE flow breaks silently.
 */

export type FeEventName =
  | "run_start"
  | "thinking_start"
  | "thinking_delta"
  | "thinking_end"
  | "message_start"
  | "message_delta"
  | "message_end"
  | "tool_start"
  | "tool_end"
  | "approval_required"
  | "agent_end"
  | "keep-alive"
  | "error"
  // Attachment lifecycle (runtime → server → FE).
  | "attachments_processed"
  | "attachment_error"
  // Generated output artifacts rendered inline in chat.
  | "artifact_created";

export interface AttachmentsProcessed {
  type: "attachments_processed";
  conversationId: string;
  count: number;
  images: number;
  documents: number;
  references: Array<{
    id: string;
    name: string;
    kind: "image" | "document";
    mimeType: string;
    sizeBytes: number;
  }>;
  timestamp: string;
}

export interface AttachmentErrorPayload {
  type: "attachment_error";
  reason: "unsupported" | "too-large" | "fetch-failed" | "processing-failed";
  message: string;
  attachment?: unknown;
  timestamp: string;
}

export interface ArtifactPayload {
  id: string;
  type: string;
  title?: string;
  file_name: string;
  file_type: string;
  file_url: string;
  file_size?: number;
  preview_url?: string;
  content_preview?: string;
  source?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactCreated {
  type: "artifact_created";
  conversationId: string;
  artifact: ArtifactPayload;
  timestamp: string;
}

export interface RunStart {
  type: "run_start";
  conversationId: string;
  provider?: string;
  model?: string;
  model_name?: string;
  timestamp: string;
}

export interface ThinkingDelta {
  type: "thinking_delta";
  thinking_delta: string;
  timestamp: string;
}

export interface MessageDelta {
  type: "message_delta";
  message_delta: string;
  source_agent: string;
  delegation_id: string;
  timestamp: string;
}

export interface ToolStart {
  type: "tool_start";
  tool_call_id: string;
  tool_name: string;
  args: unknown;
  timestamp: string;
}

export interface ToolEnd {
  type: "tool_end";
  tool_call_id: string;
  tool_name?: string;
  args?: unknown;
  output?: string;
  is_error?: boolean;
  timestamp: string;
}

export interface ApprovalRequired {
  type: "approval_required";
  id: string;
  tool: string;
  command: string;
  timeout_ms: number;
  timestamp: string;
}

export interface AgentEnd {
  type: "agent_end";
  stop_reason: string;
  usage_info?: unknown;
  error_message?: string;
  timestamp: string;
}
