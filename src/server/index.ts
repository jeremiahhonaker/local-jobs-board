import { join } from "node:path";
import app from "./app";
import { env } from "./env";
import { runMigrations } from "./migrate";

const PUBLIC_DIR = join(import.meta.dir, "..", "..", "dist", "public");

/** Serves the built client. Unknown paths fall back to index.html (SPA). */
async function serveStatic(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = join(PUBLIC_DIR, pathname);
  // Stay inside the public dir even for odd paths like /../...
  if (!filePath.startsWith(PUBLIC_DIR)) return new Response("Not found", { status: 404 });
  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);
  return new Response(Bun.file(join(PUBLIC_DIR, "index.html")));
}

await runMigrations();
console.log(`[jobs-board] Database ready (Turso: ${env.tursoUrl ? "yes" : "no, local file"})`);

Bun.serve({
  port: env.port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (
      url.pathname === "/health" ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/")
    ) {
      return app.fetch(req);
    }
    return serveStatic(req);
  },
});

console.log(`[jobs-board] Listening on http://localhost:${env.port} (${env.nodeEnv})`);
