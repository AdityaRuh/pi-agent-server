# pi-agent-server (Image 2)

The network façade. Sits between the **Ruh-agent-gateway** and the
**pi-sdk-runtime** (Image 1).

## Why this exists

- The gateway speaks a fixed SSE event vocabulary (`run_start`,
  `thinking_delta`, `message_delta`, `tool_start`, `tool_end`,
  `approval_required`, `agent_end`).
- Pi SDK emits richer, lower-level events.
- This server **translates** between the two and adds nothing else.

## API surface

All endpoints require `Authorization: Bearer <GATEWAY_SHARED_TOKEN>` (or the
equivalent `X-Gateway-Token` header).

| Method | Path                       | Purpose                                                       |
| ------ | -------------------------- | ------------------------------------------------------------- |
| POST   | `/chat`                    | Start a chat run. SSE response in the gateway vocab.          |
| GET    | `/resume`                  | Replay missed events since `?fromEventId=N`, then tail live.  |
| POST   | `/stop`                    | Abort the active run.                                         |
| POST   | `/approve`                 | Forward an approval decision.                                 |
| POST   | `/ask-user/answer`         | Forward an ask-user answer.                                   |
| POST   | `/steer`                   | Inject extra context into a streaming run.                    |
| POST   | `/follow-up`               | Queue a follow-up prompt after the current turn.              |
| POST   | `/model`                   | Switch model mid-conversation.                                |
| POST   | `/thinking-level`          | Set or cycle the model's thinking depth.                      |
| GET    | `/status`                  | Liveness + buffer summary + runtime status.                   |

The SSE event vocabulary emitted by `/chat` and `/resume` is identical to the
one the existing OpenClaw gateway flow emits — `run_start`, `thinking_*`,
`message_*`, `tool_*`, `approval_required`, `agent_end`, plus `subagent_*`
and `usage` for nested progress and cost tracking. **The gateway does not
need any code changes to talk to this server.**

### Attachments

`POST /chat` accepts an optional `attachments` array. Each entry is
`{ url, mimeType, name, sizeBytes? }`. The runtime:

- downloads each URL into `/workspace/attachments/<conversationId>/`,
- passes images as base64 `PromptOptions.images` to `session.prompt`,
- appends a structured prompt suffix that lists document local paths so
  the agent can call its bundled `document_parse` tool on demand,
- emits `attachments_processed` once classification is done and
  `attachment_error` (with `reason: unsupported | too-large | fetch-failed | processing-failed`)
  if anything blocks the run.

Supported image MIMEs: `image/png`, `image/jpeg`, `image/webp`, `image/gif`.
Supported document MIMEs: `pdf`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`,
`rtf`, `csv`, `tsv`, `md`, `txt`, `yaml`, `json`. Anything else fails with
a clear `attachment_error`. Defaults: 10 MB image cap, 20 MB document cap,
10 attachments per message (configurable via runtime env vars).

## Resume mechanics

Every SSE event forwarded by `/chat` is also recorded in an in-memory
per-conversation event buffer (ring of the last 1000 events). When the FE
reconnects:

```
GET /resume?conversationId=c1&fromEventId=42
```

…the server replays events `43, 44, …` and either closes (if the run has
finished) or keeps streaming live events as they arrive.

This is in-memory only — a process restart clears the buffers. For
multi-replica deployment, swap `src/lib/event-buffer.ts` for a Redis
Streams (`xadd` / `xrange`) implementation; the interface is intentionally
compatible.

## Run locally with both images

```sh
cp .env.example .env
# Spin up both pi-sdk-runtime and pi-agent-server on a shared internal network:
docker compose up --build
```

Then hit the server from your host:

```sh
curl -N -X POST http://localhost:8080/chat \
  -H "Authorization: Bearer change-me-in-prod" \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"c1","message":"list the files here"}'
```

## Repo layout

```
src/
  server.ts                # Elysia bootstrap on PORT
  routes/
    chat.route.ts          # the 6 endpoints
  clients/
    sdk-client.ts          # HTTP+SSE client to pi-sdk-runtime
  lib/
    auth.ts                # X-Gateway-Token / Authorization check
    env.ts                 # Bun.env parsing
    sse.ts                 # SSE encoder + heartbeats
    event-formatter.ts     # Pi SDK events → gateway FE events
  types/
    events.ts              # the FE event shapes (single source of truth)
```
