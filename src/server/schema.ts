import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Local Jobs Board — standalone schema.
 *
 * Fresh design for the public launch rebuild. The artifact's data model was
 * one `jobs` table; this adds users, magic-link tokens, and sessions so real
 * people have accounts and ownership rules apply.
 *
 * Money is stored in integer cents. The board fee (10% of a job's pay) is
 * computed server-side when a job is marked complete and recorded on the
 * job row. No real money moves in this build — fees are recorded only.
 */

// ---------------------------------------------------------------- users ---

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  // Display name + phone, saved from the contact details a user enters when
  // posting or claiming a job. Used only to prefill those forms.
  name: text("name"),
  phone: text("phone"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// ---------------------------------------------------------- magic links ---

export const magicLinks = sqliteTable("magic_links", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  // SHA-256 hex of the token. The raw token only ever travels in the email.
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// ------------------------------------------------------------- sessions ---

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  // SHA-256 hex of the session token stored in the httpOnly cookie.
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// ----------------------------------------------------------------- jobs ---

export const JOB_CATEGORIES = [
  "yard-work",
  "moving-help",
  "cleaning",
  "hauling",
  "handyman",
  "errands",
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

export const JOB_STATUSES = ["open", "claimed", "completed", "cancelled"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  posterId: text("poster_id")
    .notNull()
    .references(() => users.id),

  title: text("title").notNull(),
  category: text("category").notNull(), // one of JOB_CATEGORIES
  description: text("description").notNull().default(""),
  payCents: integer("pay_cents").notNull(),
  // General area only — a neighborhood or town. Never a street address.
  area: text("area").notNull(),
  // Plain calendar date (YYYY-MM-DD) the poster picks. Stored and shown
  // as-is with no timezone conversion. Null means "no date set".
  dateNeeded: text("date_needed"),

  status: text("status").notNull().default("open"), // one of JOB_STATUSES

  // Poster contact, shown ONLY to the claimer of this job (and the poster).
  posterName: text("poster_name").notNull(),
  posterPhone: text("poster_phone").notNull().default(""),
  posterEmail: text("poster_email").notNull().default(""),

  // Claimer, set when a worker claims the job. Contact shown ONLY to the
  // poster of this job (and the claimer).
  claimerId: text("claimer_id").references(() => users.id),
  claimerName: text("claimer_name"),
  claimerPhone: text("claimer_phone"),
  claimerEmail: text("claimer_email"),

  // 10% of payCents, computed server-side on completion. Null until then.
  feeCents: integer("fee_cents"),

  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
});

export type User = typeof users.$inferSelect;
export type Job = typeof jobs.$inferSelect;
