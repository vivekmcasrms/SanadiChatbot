# Sanadi — application container for local deployment.
# The database/auth/storage stack is NOT in this image; it is provided by the
# local Supabase stack (see LOCAL_SETUP.md). This image only runs the app.

FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.2 AS runtime
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 8080
# Dev server is the guaranteed-working local mode (HMR, no extra runtime needed).
# For a production-style run inside the container:
#   bun run build && bunx vite preview --host 0.0.0.0 --port 8080

CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]
