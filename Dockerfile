# Local Jobs Board — production image (Bun + React client + Hono server)
FROM oven/bun:1-slim AS base
WORKDIR /app

# Install dependencies first (cached unless package.json / lockfile change)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build the client bundle into dist/public
COPY . .
RUN bun run build

# Render injects PORT; the server reads it from the environment.
EXPOSE 3000

# The server runs pending Drizzle migrations on startup, then serves the API
# and the built client on the same port.
CMD ["bun", "run", "src/server/index.ts"]
