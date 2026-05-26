import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// Ensure the data directory exists (important inside Docker)
const dbDir = path.dirname(config.DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.DATABASE_PATH);

// WAL mode gives better read concurrency; foreign keys for referential integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  -- Members whose Discord accounts have been successfully verified
  CREATE TABLE IF NOT EXISTS verified_members (
    discord_id            TEXT    PRIMARY KEY,
    wildapricot_contact_id INTEGER NOT NULL,
    email                 TEXT    NOT NULL,
    membership_level      TEXT    NOT NULL,
    membership_status     TEXT    NOT NULL,
    verified_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    last_synced_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Prevent two Discord accounts from claiming the same email
  CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_email
    ON verified_members(email);

  -- In-flight verification sessions (one per Discord user)
  CREATE TABLE IF NOT EXISTS pending_verifications (
    discord_id  TEXT    PRIMARY KEY,
    email       TEXT    NOT NULL,
    otp_hash    TEXT    NOT NULL,            -- SHA-256 of the OTP
    expires_at  INTEGER NOT NULL,            -- Unix timestamp (seconds)
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface VerifiedMember {
  discord_id: string;
  wildapricot_contact_id: number;
  email: string;
  membership_level: string;
  membership_status: string;
  verified_at: string;
  last_synced_at: string;
}

export interface PendingVerification {
  discord_id: string;
  email: string;
  otp_hash: string;
  expires_at: number;
  attempts: number;
  created_at: string;
}

// ─── Prepared statements ───────────────────────────────────────────────────────

export const statements = {
  // ── Verified members ──────────────────────────────────────────────────────

  getVerifiedMember: db.prepare<[string], VerifiedMember>(
    'SELECT * FROM verified_members WHERE discord_id = ?',
  ),

  getVerifiedMemberByEmail: db.prepare<[string], VerifiedMember>(
    'SELECT * FROM verified_members WHERE email = ?',
  ),

  getAllVerifiedMembers: db.prepare<[], VerifiedMember>(
    'SELECT * FROM verified_members',
  ),

  /**
   * Insert or update a verified member record.
   * On conflict (same discord_id), all fields except verified_at are updated.
   */
  upsertVerifiedMember: db.prepare(`
    INSERT INTO verified_members
      (discord_id, wildapricot_contact_id, email, membership_level, membership_status, last_synced_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(discord_id) DO UPDATE SET
      wildapricot_contact_id = excluded.wildapricot_contact_id,
      email                  = excluded.email,
      membership_level       = excluded.membership_level,
      membership_status      = excluded.membership_status,
      last_synced_at         = excluded.last_synced_at
  `),

  deleteVerifiedMember: db.prepare<[string]>(
    'DELETE FROM verified_members WHERE discord_id = ?',
  ),

  // ── Pending verifications ─────────────────────────────────────────────────

  getPendingVerification: db.prepare<[string], PendingVerification>(
    'SELECT * FROM pending_verifications WHERE discord_id = ?',
  ),

  /** INSERT OR REPLACE: replaces any existing row for this discord_id, resetting attempts to 0 */
  upsertPendingVerification: db.prepare(`
    INSERT OR REPLACE INTO pending_verifications (discord_id, email, otp_hash, expires_at, attempts)
    VALUES (?, ?, ?, ?, 0)
  `),

  incrementAttempts: db.prepare<[string]>(
    'UPDATE pending_verifications SET attempts = attempts + 1 WHERE discord_id = ?',
  ),

  deletePendingVerification: db.prepare<[string]>(
    'DELETE FROM pending_verifications WHERE discord_id = ?',
  ),

  cleanExpiredVerifications: db.prepare(
    "DELETE FROM pending_verifications WHERE expires_at < strftime('%s','now')",
  ),
};
