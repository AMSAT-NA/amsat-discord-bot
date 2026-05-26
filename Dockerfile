# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# dumb-init ensures proper PID 1 behaviour and signal forwarding
RUN apk add --no-cache dumb-init

# Non-root user for security
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

# Persistent data directory (mounted as a volume)
RUN mkdir -p /data && chown botuser:botgroup /data

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output from builder
COPY --from=builder /app/dist ./dist

USER botuser

VOLUME ["/data"]

EXPOSE 0

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
