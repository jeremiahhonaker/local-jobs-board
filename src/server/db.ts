import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "./env";
import * as schema from "./schema";

function createDb() {
  if (env.tursoUrl) {
    // Production: Turso hosted SQLite (same SQLite dialect as local dev).
    const client = createClient({
      url: env.tursoUrl,
      authToken: env.tursoAuthToken ?? undefined,
    });
    return drizzle(client, { schema });
  }

  // Local dev: SQLite file on disk. Make sure the directory exists first.
  const filePath = env.localDbPath;
  mkdirSync(dirname(filePath), { recursive: true });
  const client = createClient({ url: `file:${filePath}` });
  return drizzle(client, { schema });
}

export const db = createDb();
export { schema };
