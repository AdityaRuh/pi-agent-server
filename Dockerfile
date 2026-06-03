# ─────────────────────────────────────────────────────────────────────────────
# pi-agent-server — Image 2
# Network façade in front of pi-sdk-runtime. Receives chat traffic from the
# Ruh-agent-gateway, forwards to pi-sdk-runtime, translates raw Pi SDK events
# into the gateway's existing FE SSE vocabulary.
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

FROM oven/bun:1.1-alpine AS runner
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY src ./src
COPY tsconfig.json ./tsconfig.json

EXPOSE 8080
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup -S piuser && adduser -S piuser -G piuser
USER piuser

CMD ["bun", "src/server.ts"]
