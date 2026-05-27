# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Commit SHA passed in by GitHub Actions (--build-arg COMMIT_SHA=${{ github.sha }})
# Falls back to 'development' for local builds without the arg set.
ARG COMMIT_SHA=development

WORKDIR /app

# Build tools required by better-sqlite3 (native module compiled via node-gyp).
# These stay in the builder stage and never reach the production image.
RUN apk add --no-cache python3 make g++

# Install all dependencies (including dev) for the TypeScript compile step
COPY package*.json ./
RUN npm ci

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies so we can copy a clean node_modules to production
RUN npm prune --omit=dev


# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:22-alpine AS production

# Re-declare ARG and promote to ENV so it is readable at runtime as process.env.COMMIT_SHA
ARG COMMIT_SHA=development
ENV COMMIT_SHA=${COMMIT_SHA}

WORKDIR /app

# dumb-init ensures proper PID 1 behaviour and signal forwarding
RUN apk add --no-cache dumb-init

# Non-root user for security
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

# Persistent data directory (mounted as a volume)
RUN mkdir -p /data && chown botuser:botgroup /data

# Copy the pruned node_modules from the builder — the native better-sqlite3
# binary was already compiled there against the same Alpine/Node base, so no
# recompilation (and no Python/make/g++) is needed here.
COPY --from=builder /app/node_modules ./node_modules

# Compiled JS output
COPY --from=builder /app/dist ./dist

# package.json is needed at runtime for module resolution
COPY package.json ./

USER botuser

VOLUME ["/data"]

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
