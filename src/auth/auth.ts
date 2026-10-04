import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from '../db/db.js';

// OWASP Password Storage Cheat Sheet baseline for Argon2id: m=19 MiB, t=2, p=1.
// algorithm 2 is Argon2id; the package exposes it only as an ambient const enum.
const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const SESSION_COOKIE = 'sp_session';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
}

export interface Session {
  idHash: Buffer;
  csrfToken: string;
  user: SessionUser;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Equalises timing for unknown accounts, so the response does not reveal which emails exist. */
export async function burnVerification(password: string): Promise<void> {
  dummy ??= hashPassword('signalpost-timing-equaliser');
  await verifyPassword(await dummy, password);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest();

export function createSession(db: Db, userId: number, ttlHours: number, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = now + ttlHours * 3_600_000;
  db.prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(
    tokenHash(token),
    userId,
    csrfToken,
    expiresAt,
  );
  return { token, csrfToken, expiresAt };
}

export function findSession(db: Db, token: string, now = Date.now()): Session | null {
  if (!token || token.length > 128) return null;
  const idHash = tokenHash(token);
  const row = db
    .prepare(
      `SELECT s.csrf_token, u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ? AND s.expires_at > ?`,
    )
    .get(idHash, now) as { csrf_token: string; id: number; email: string; name: string } | undefined;
  if (!row) return null;
  return { idHash, csrfToken: row.csrf_token, user: { id: row.id, email: row.email, name: row.name } };
}

export function deleteSession(db: Db, idHash: Buffer): void {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
}

export function findUserByEmail(db: Db, email: string) {
  return db
    .prepare('SELECT id, email, name, password_hash AS passwordHash FROM users WHERE email = ?')
    .get(email) as { id: number; email: string; name: string; passwordHash: string } | undefined;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
