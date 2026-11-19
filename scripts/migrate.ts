import { runMigrations } from "../src/server/migrate";

// One-off migration runner: `bun run db:migrate`.
// The server also runs migrations on startup (see src/server/index.ts),
// so this is mainly for applying migrations without starting the server.
await runMigrations();
console.log("Migrations applied.");
process.exit(0);
