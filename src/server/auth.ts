import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hashToken, randomToken } from "./crypto";
import { db } from "./db";
import { env } from "./env";
import { magicLinks, sessions, users } from "./schema";
import type { User } from "./schema";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isOwner(user: User | null): boolean {
  return !!user && !!env.ownerEmail && user.email.toLowerCase() === env.ownerEmail;
}

/** Finds the user for an email, creating the account on first sign-in. */
export async function findOrCreateUserByEmail(email: string): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(users)
    .values({ id: randomUUID(), email: normalized, createdAt: now })
    .returning();
  if (!created) throw new Error("Failed to create user");
  return created;
}

/** Creates a one-time magic link for the user and returns its full URL. */
export async function createMagicLink(user: User): Promise<string> {
  const token = randomToken();
  const now = new Date();
  await db.insert(magicLinks).values({
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
    createdAt: now,
  });
  return `${env.appUrl}/auth/verify?token=${token}`;
}

/** Verifies a magic-link token. Returns the user on success, null otherwise.
 * Tokens are single-use: a successful verification marks the link used. */
export async function verifyMagicLink(token: string): Promise<User | null> {
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, hashToken(token)))
    .limit(1);
  if (!link) return null;
  if (link.usedAt) return null;
  if (link.expiresAt.getTime() < Date.now()) return null;

  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, link.id));

  const [user] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1);
  return user ?? null;
}

/** Creates a session and returns the raw token to store in the cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const now = new Date();
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
  });
  return token;
}

/** Resolves a session cookie token to its user, or null. */
export async function getUserFromSessionToken(token: string | null | undefined): Promise<User | null> {
  if (!token) return null;
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  return user ?? null;
}

/** Deletes a session (sign-out). */
export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Saves contact details onto the user's profile (used to prefill forms).
 * Only fills in blanks — it never overwrites details the user already set. */
export async function rememberContact(
  userId: string,
  contact: { name?: string; phone?: string },
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  const patch: { name?: string; phone?: string } = {};
  if (contact.name && !user.name) patch.name = contact.name;
  if (contact.phone && !user.phone) patch.phone = contact.phone;
  if (Object.keys(patch).length > 0) {
    await db.update(users).set(patch).where(eq(users.id, userId));
  }
}
