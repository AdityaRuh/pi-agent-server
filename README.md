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

| Method | Path                       | Purpose                                              |
| ------ | -------------------------- | ---------------------------------------------------- |
| POST   | `/chat`                    | Start a chat run. SSE response in the gateway vocab. |
| GET    | `/resume`                  | Re-attach to an in-flight run (stub for MVP).        |
| POST   | `/stop`                    | Abort the active run.                                |
| POST   | `/approve`                 | Forward an approval decision.                        |
| POST   | `/ask-user/answer`         | Forward an ask-user answer.                          |
| GET    | `/status`                  | Liveness + active conversation ids.                  |

The SSE event vocabulary emitted by `/chat` and `/resume` is identical to the
one the existing OpenClaw gateway flow emits. **The gateway does not need any
code changes to talk to this server.**

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
