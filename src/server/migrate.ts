import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./db";

/** Applies every migration in ./drizzle that has not run yet. Idempotent —
 * safe to call on every server start. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
}
