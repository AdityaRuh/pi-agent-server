/**
 * Entry point. Boots Elysia on PORT and mounts the chat routes.
 */

import { Elysia } from "elysia";
import { env } from "@/lib/env";
import { chatRoute } from "@/routes/chat.route";

const app = new Elysia({ name: "pi-agent-server" })
  .onError(({ error, set }) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "unauthorized") {
      set.status = 401;
      return { error: { code: "unauthorized", message: "bad token" } };
    }
    set.status = 500;
    return { error: { code: "internal", message: msg } };
  })
  .get("/healthz", () => ({ ok: true }))
  .use(chatRoute)
  .listen({ port: env.port, hostname: env.host });

// biome-ignore lint/suspicious/noConsoleLog: boot banner
console.log(`pi-agent-server listening on http://${env.host}:${env.port}`);
// biome-ignore lint/suspicious/noConsoleLog: boot banner
console.log(`  forwarding to pi-sdk-runtime at ${env.piSdkRuntimeUrl}`);

function shutdown(signal: string) {
  // biome-ignore lint/suspicious/noConsoleLog: shutdown banner
  console.log(`[pi-agent-server] ${signal} received, stopping`);
  app.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
