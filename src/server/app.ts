import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { z } from "zod";
import {
  createMagicLink,
  createSession,
  destroySession,
  findOrCreateUserByEmail,
  getUserFromSessionToken,
  isOwner,
  rememberContact,
  verifyMagicLink,
} from "./auth";
import { db } from "./db";
import { env } from "./env";
import { sendMagicLinkEmail } from "./mail";
import { JOB_CATEGORIES, jobs } from "./schema";
import type { Job, User } from "./schema";

// ------------------------------------------------------------------ setup ---

type Variables = { user: User | null };

const app = new Hono<{ Variables: Variables }>();

const SESSION_COOKIE = "ljb_session";
const BOARD_FEE_RATE = 0.1; // 10% of a job's pay, recorded on completion.

/** Resolve the session cookie into a user (or null) on every request. */
app.use(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  c.set("user", await getUserFromSessionToken(token));
  await next();
});

function requireAuth(c: { get: (key: "user") => User | null }): User | null {
  return c.get("user");
}

function setSessionCookie(
  c: Parameters<typeof setCookie>[0],
  token: string,
  maxAgeSeconds: number,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: env.isProd,
    maxAge: maxAgeSeconds,
  });
}

// ------------------------------------------------------------- rate limit ---

/** Tiny in-memory rate limiter for magic-link requests. */
const rateLimitHits = new Map<string, number[]>();
function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateLimitHits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return true;
  hits.push(now);
  rateLimitHits.set(key, hits);
  return false;
}

// --------------------------------------------------------------- validation ---

const emailSchema = z.email().max(254);
const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(254).optional().default(""),
});

const createJobSchema = z.object({
  title: z.string().trim().min(3, "Title is too short").max(120),
  category: z.enum(JOB_CATEGORIES),
  description: z.string().trim().max(2000).optional().default(""),
  /** Pay in whole dollars, $1–$10,000. Converted to cents server-side. */
  pay: z.number().min(1, "Pay must be at least $1").max(10000).finite(),
  /** General area only — neighborhood or town. Never a street address. */
  area: z.string().trim().min(2, "Area is required").max(100),
  /** Optional plain date (YYYY-MM-DD). */
  dateNeeded: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must look like YYYY-MM-DD")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  contact: contactSchema,
});

const claimSchema = z.object({ contact: contactSchema });

function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function feeFor(payCents: number): number {
  return Math.round(payCents * BOARD_FEE_RATE);
}

// ------------------------------------------------------------ serialization ---

/** Public shape: what anyone browsing the board sees. No contact details,
 * no user ids. The 10% fee is shown on every posting. */
function publicJob(job: Job) {
  return {
    id: job.id,
    title: job.title,
    category: job.category,
    description: job.description,
    payCents: job.payCents,
    feeCents: feeFor(job.payCents),
    workerCents: job.payCents - feeFor(job.payCents),
    area: job.area,
    dateNeeded: job.dateNeeded,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
  };
}

type PublicJob = ReturnType<typeof publicJob>;

/** Private shape: the public shape plus contact details, only ever sent to
 * the poster or the claimer of that job. */
function privateJob(job: Job, viewer: User): PublicJob & {
  posterName: string;
  posterPhone: string;
  posterEmail: string;
  claimerName: string | null;
  claimerPhone: string | null;
  claimerEmail: string | null;
  isPoster: boolean;
  isClaimer: boolean;
} {
  return {
    ...publicJob(job),
    posterName: job.posterName,
    posterPhone: job.posterPhone,
    posterEmail: job.posterEmail,
    claimerName: job.claimerName,
    claimerPhone: job.claimerPhone,
    claimerEmail: job.claimerEmail,
    isPoster: job.posterId === viewer.id,
    isClaimer: job.claimerId === viewer.id,
  };
}

function isParty(job: Job, user: User | null): user is User {
  return !!user && (job.posterId === user.id || job.claimerId === user.id);
}

// ------------------------------------------------------------------ health ---

app.get("/health", (c) => c.json({ ok: true }));

// -------------------------------------------------------------------- auth ---

app.post("/api/auth/magic-link", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ email: emailSchema }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Enter a valid email address." }, 400);

  const email = parsed.data.email.trim().toLowerCase();
  const ip = c.req.header("x-forwarded-for") ?? "unknown";
  if (rateLimited(`email:${email}`, 5, 60 * 60 * 1000) || rateLimited(`ip:${ip}`, 20, 60 * 60 * 1000)) {
    return c.json({ error: "Too many sign-in requests. Try again in a bit." }, 429);
  }

  const user = await findOrCreateUserByEmail(email);
  const link = await createMagicLink(user);
  const sent = await sendMagicLinkEmail(email, link);
  if (!sent) return c.json({ error: "Couldn't send the email. Try again in a bit." }, 500);

  // Dev only: return the link so local tests can sign in without email.
  // Never enabled in production (requires DEV_AUTH_DEBUG=1).
  if (env.devAuthDebug) return c.json({ ok: true, devLink: link });
  return c.json({ ok: true });
});

app.get("/auth/verify", async (c) => {
  const token = c.req.query("token") ?? "";
  const user = await verifyMagicLink(token);
  if (!user) return c.redirect("/?auth=invalid", 302);

  const sessionToken = await createSession(user.id);
  setSessionCookie(c, sessionToken, 30 * 24 * 60 * 60);
  return c.redirect("/", 302);
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ user: null }, 401);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      isOwner: isOwner(user),
    },
  });
});

// -------------------------------------------------------------------- jobs ---

app.get("/api/jobs", async (c) => {
  const category = c.req.query("category");
  const where = [eq(jobs.status, "open")];
  if (category && (JOB_CATEGORIES as readonly string[]).includes(category)) {
    where.push(eq(jobs.category, category));
  }
  const rows = await db
    .select()
    .from(jobs)
    .where(and(...where))
    .orderBy(desc(jobs.createdAt));
  return c.json({ jobs: rows.map(publicJob) });
});

app.post("/api/jobs", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Sign in to post a job." }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, 400);
  }
  const input = parsed.data;

  const [created] = await db
    .insert(jobs)
    .values({
      id: randomUUID(),
      posterId: user.id,
      title: input.title,
      category: input.category,
      description: input.description,
      payCents: dollarsToCents(input.pay),
      area: input.area,
      dateNeeded: input.dateNeeded,
      status: "open",
      posterName: input.contact.name,
      posterPhone: input.contact.phone,
      posterEmail: input.contact.email,
      createdAt: new Date(),
    })
    .returning();
  if (!created) return c.json({ error: "Couldn't save the job. Try again." }, 500);

  await rememberContact(user.id, { name: input.contact.name, phone: input.contact.phone });
  return c.json({ job: privateJob(created, user) }, 201);
});

app.get("/api/jobs/:id", async (c) => {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, c.req.param("id"))).limit(1);
  if (!job) return c.json({ error: "Job not found." }, 404);
  const user = c.get("user");
  if (isParty(job, user)) return c.json({ job: privateJob(job, user) });
  return c.json({ job: publicJob(job) });
});

app.post("/api/jobs/:id/claim", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Sign in to claim a job." }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, 400);
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, c.req.param("id"))).limit(1);
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (job.status !== "open") return c.json({ error: "This job is no longer open." }, 409);
  if (job.posterId === user.id) return c.json({ error: "You can't claim your own job." }, 403);

  const [updated] = await db
    .update(jobs)
    .set({
      status: "claimed",
      claimerId: user.id,
      claimerName: parsed.data.contact.name,
      claimerPhone: parsed.data.contact.phone,
      claimerEmail: parsed.data.contact.email,
    })
    .where(eq(jobs.id, job.id))
    .returning();
  if (!updated) return c.json({ error: "Couldn't claim the job. Try again." }, 500);

  await rememberContact(user.id, { name: parsed.data.contact.name, phone: parsed.data.contact.phone });
  return c.json({ job: privateJob(updated, user) });
});

app.post("/api/jobs/:id/unclaim", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Sign in first." }, 401);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, c.req.param("id"))).limit(1);
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (job.status !== "claimed" || job.claimerId !== user.id) {
    return c.json({ error: "Only the worker who claimed this job can release it." }, 403);
  }

  const [updated] = await db
    .update(jobs)
    .set({
      status: "open",
      claimerId: null,
      claimerName: null,
      claimerPhone: null,
      claimerEmail: null,
    })
    .where(eq(jobs.id, job.id))
    .returning();
  if (!updated) return c.json({ error: "Couldn't release the job. Try again." }, 500);
  return c.json({ job: publicJob(updated) });
});

app.post("/api/jobs/:id/complete", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Sign in first." }, 401);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, c.req.param("id"))).limit(1);
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (!isParty(job, user)) {
    return c.json({ error: "Only the poster or the worker can mark this job done." }, 403);
  }
  if (job.status !== "claimed") {
    return c.json({ error: "Only a claimed job can be marked done." }, 409);
  }

  // The 10% board fee is computed here, server-side, and recorded on the row.
  const [updated] = await db
    .update(jobs)
    .set({ status: "completed", feeCents: feeFor(job.payCents), completedAt: new Date() })
    .where(eq(jobs.id, job.id))
    .returning();
  if (!updated) return c.json({ error: "Couldn't complete the job. Try again." }, 500);
  return c.json({ job: privateJob(updated, user) });
});

app.post("/api/jobs/:id/cancel", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Sign in first." }, 401);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, c.req.param("id"))).limit(1);
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (job.posterId !== user.id) {
    return c.json({ error: "Only the person who posted this job can cancel it." }, 403);
  }
  if (job.status !== "open" && job.status !== "claimed") {
    return c.json({ error: "This job can't be cancelled anymore." }, 409);
  }

  const [updated] = await db
    .update(jobs)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(jobs.id, job.id))
    .returning();
  if (!updated) return c.json({ error: "Couldn't cancel the job. Try again." }, 500);
  return c.json({ job: privateJob(updated, user) });
});

// -------------------------------------------------------------- my activity ---

app.get("/api/my/activity", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Sign in first." }, 401);

  const rows = await db
    .select()
    .from(jobs)
    .where(or(eq(jobs.posterId, user.id), eq(jobs.claimerId, user.id)))
    .orderBy(desc(jobs.createdAt));
  const posted = rows.filter((j) => j.posterId === user.id).map((j) => privateJob(j, user));
  const claimed = rows.filter((j) => j.claimerId === user.id).map((j) => privateJob(j, user));
  return c.json({ posted, claimed });
});

// --------------------------------------------------------------- earnings ---

app.get("/api/my/earnings", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Sign in first." }, 401);

  const completedAsWorker = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.claimerId, user.id), eq(jobs.status, "completed")));
  const completedAsPoster = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.posterId, user.id), eq(jobs.status, "completed")));

  const sum = (rows: Job[], field: "payCents" | "feeCents") =>
    rows.reduce((total, j) => total + (j[field] ?? 0), 0);

  return c.json({
    asWorker: {
      jobsCompleted: completedAsWorker.length,
      totalPayCents: sum(completedAsWorker, "payCents"),
      totalFeeCents: sum(completedAsWorker, "feeCents"),
    },
    asPoster: {
      jobsCompleted: completedAsPoster.length,
      totalSpentCents: sum(completedAsPoster, "payCents"),
    },
  });
});

/** Board-wide fee totals — the board owner only. */
app.get("/api/owner/earnings", async (c) => {
  const user = requireAuth(c);
  if (!user || !isOwner(user)) return c.json({ error: "Not available." }, 403);

  const completed = await db.select().from(jobs).where(eq(jobs.status, "completed"));
  return c.json({
    jobsCompleted: completed.length,
    totalPayCents: completed.reduce((t, j) => t + j.payCents, 0),
    totalFeeCents: completed.reduce((t, j) => t + (j.feeCents ?? 0), 0),
  });
});

export default app;
