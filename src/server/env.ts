/**
 * Central environment config. Every secret comes from the environment —
 * nothing sensitive is ever hard-coded or committed.
 *
 * Local dev needs nothing set: the database is a local SQLite file and
 * magic links are printed to the server console. Production needs the
 * variables listed in .env.example.
 */
export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",

  /** Public base URL of the deployed app, e.g. https://jobs.example.com */
  appUrl: (process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(
    /\/$/,
    "",
  ),

  /** Email of the board owner (Jeremiah). Only this account sees board-wide fee totals. */
  ownerEmail: (process.env.OWNER_EMAIL ?? "").trim().toLowerCase() || null,

  /** Resend API key for sending magic-link emails. Unset in dev = links go to the console. */
  resendApiKey: process.env.RESEND_API_KEY ?? null,
  emailFrom: process.env.EMAIL_FROM ?? "Local Jobs Board <noreply@localhost>",

  /** Dev only: when "1", the magic-link endpoint returns the sign-in link in
   * its JSON response so local end-to-end tests can complete without email.
   * Never enable in production. */
  devAuthDebug: process.env.DEV_AUTH_DEBUG === "1",

  /** Turso (hosted SQLite) connection. Unset = local file database. */
  tursoUrl: process.env.TURSO_DATABASE_URL ?? null,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN ?? null,

  /** Local SQLite file used when no Turso URL is set. */
  localDbPath: process.env.LOCAL_DB_PATH ?? "./data/local.db",
} as const;
