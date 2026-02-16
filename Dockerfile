# =============================================================================
# claude-devtools standalone Docker image
#
# Runs the HTTP server without Electron, serving the full UI over HTTP.
# Mount your ~/.claude directory to make session data available.
#
# Build:  docker build -t claude-devtools .
# Run:    docker run -p 3456:3456 -v ~/.claude:/data/.claude:ro claude-devtools
# =============================================================================

FROM node:20-slim AS builder

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Install dependencies first (better layer caching)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm standalone:build

# =============================================================================
# Production stage — minimal image with only the built output
# =============================================================================
FROM node:20-slim

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Copy package files and install production-only dependencies
# (fastify, @fastify/cors, @fastify/static are externalized from the bundle)
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built standalone server and renderer output
COPY --from=builder /app/dist-standalone ./dist-standalone
COPY --from=builder /app/out/renderer ./out/renderer

# Create data directory for Claude session mount
RUN mkdir -p /data/.claude

ENV NODE_ENV=production
ENV CLAUDE_ROOT=/data/.claude
ENV HOST=0.0.0.0
ENV PORT=3456

EXPOSE 3456

CMD ["node", "dist-standalone/index.cjs"]
