/**
 * Same SSE primitives as pi-sdk-runtime, kept independent so this image has
 * zero dependency on the other repo's code.
 */

const HEARTBEAT_MS = 15_000;

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

export function encodeSse(event: string, data: unknown, id?: string): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  let frame = "";
  if (id) frame += `id: ${id}\n`;
  frame += `event: ${event}\n`;
  for (const line of payload.split("\n")) {
    frame += `data: ${line}\n`;
  }
  frame += "\n";
  return frame;
}

export function createSseChannel(): {
  stream: ReadableStream<Uint8Array>;
  send: (event: string, data: unknown, id?: string) => void;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return {
    stream,
    send(event, data, id) {
      if (closed) return;
      controller.enqueue(encoder.encode(encodeSse(event, data, id)));
    },
    close() {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      try {
        controller.close();
      } catch {}
    },
  };
}
