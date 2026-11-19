import { createHash, randomBytes } from "node:crypto";

/** A URL-safe random token (256 bits of entropy), for magic links and sessions. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest. Only hashes are stored in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
