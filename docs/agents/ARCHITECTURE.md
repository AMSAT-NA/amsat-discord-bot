# Architecture

This document describes the system design, data flow, and key architectural decisions for the AMSAT Discord Bot. It is intended to give an agent sufficient context to work on the codebase without requiring a full read of every source file.

---

## What This Bot Does

Members of AMSAT run `/verify start` in Discord, receive a one-time code at their WildApricot email address, then run `/verify confirm` to get their Discord role automatically assigned. Roles are re-synced nightly to stay current with WildApricot membership status.

Admins retain a read-only callsign lookup via `/admin lookup` that mirrors the behaviour of the original manual `!verify` command this bot replaced.

---

## System Boundaries

```
Discord (user input / role assignment)
    │
    ▼
Discord Bot (Node.js / TypeScript)
    │
    ├─► WildApricot REST API v2.2   — authoritative membership database
    ├─► Amazon SES                  — OTP email delivery
    └─► SQLite (local file)         — verified member store, OTP sessions, command usage metrics
```

There is no external database, no HTTP server, and no message queue. Everything runs in a single Node.js process inside Docker.

---

## Source Tree

```
src/
├── commands/
│   ├── verify.ts        # /verify start + /verify confirm
│   ├── membership.ts    # /membership — status check + role refresh
│   ├── admin.ts         # /admin lookup | resync | unlink
│   └── index.ts         # Collection<string, Command> registry
├── services/
│   ├── wildapricot.ts   # WildApricot API client
│   └── email.ts         # Amazon SES client
├── db/
│   └── index.ts         # SQLite schema + all prepared statements
├── utils/
│   ├── otp.ts           # OTP generation + SHA-256 hashing
│   ├── roles.ts         # Discord role assignment logic
│   └── logger.ts        # Structured stdout/stderr logger
├── config.ts            # Zod-validated env config — single source of truth
├── sync.ts              # Nightly cron job (node-cron)
├── deploy-commands.ts   # One-shot slash command registration script
└── index.ts             # Entry point — Discord client + event loop
```

---

## Data Flow

### Verification flow

```
/verify start email:user@example.com
  1. config.ts          — email validated as string
  2. db/index.ts        — check for existing claim on that email
  3. wildapricot.ts     — lookupContactByEmail() → WildApricotContact | null
  4. otp.ts             — generateOtp() → 6-digit string
  5. otp.ts             — hashOtp()     → SHA-256 hex string
  6. db/index.ts        — upsertPendingVerification (discord_id, email, hash, expires_at)
  7. email.ts           — sendVerificationEmail() via SES

/verify confirm code:482910
  1. db/index.ts        — getPendingVerification(discord_id)
  2. otp.ts             — verifyOtp(candidate, storedHash)
  3. wildapricot.ts     — lookupContactByEmail() — fresh fetch
  4. roles.ts           — applyMembershipRole(guildMember, contact)
  5. db/index.ts        — upsertVerifiedMember, deletePendingVerification
```

### Nightly sync flow

```
sync.ts (cron)
  for each row in verified_members:
    1. wildapricot.ts  — lookupContactById(wildapricot_contact_id)
    2. roles.ts        — applyMembershipRole(guildMember, contact)
    3. db/index.ts     — upsertVerifiedMember (updates last_synced_at)
```

---

## Key Architectural Decisions

### SQLite over a hosted database
This bot serves a single Discord guild. SQLite is sufficient, eliminates an external dependency, and the data is small (one row per verified member). The database file lives in a Docker named volume at `/data/bot.db`. Do not switch to Postgres or MySQL without a clear scaling reason.

### WildApricot is the authority
Discord roles are always derived from WildApricot — never the other way around. If a role is manually assigned in Discord, the next sync or `/membership` call may remove it. The bot owns all roles listed in `ROLE_MAP` and `LAPSED_ROLE_ID`.

### OTPs are hashed before storage
`otp.ts` SHA-256 hashes all codes before writing to SQLite. The plaintext OTP exists only in memory during the request and in the email. This is enforced in `verify.ts` — do not store raw OTP strings.

### All replies are ephemeral
Every `interaction.reply()` and `interaction.editReply()` in command handlers uses `ephemeral: true`. Membership information must never be visible to the channel. This is a deliberate policy, not an oversight.

### Token caching in wildapricot.ts
The WildApricot OAuth2 token is cached in a module-level variable with an expiry check. There is no Redis or external cache. This is intentional — the bot is single-process. Do not move this to the database.

### The `/admin` command is designed to be extended
`admin.ts` uses Discord.js subcommands. Adding new admin functionality means adding a `.addSubcommand()` block to the builder, a routing line in `execute()`, and a new `handleX()` function. No structural changes needed.

---

## Configuration

All configuration is in `src/config.ts`, validated with Zod at startup. The process exits with a clear error message if any required variable is missing or malformed. **Never add a hardcoded value to source code that should be configurable** — add it to the Zod schema and `.env.example` instead.

The `ROLE_MAP` env var is a JSON string mapping WildApricot membership level names (exact string match, case-sensitive) to Discord role IDs. An unmapped level logs a warning but does not throw.

---

## Discord.js Version

The bot uses **discord.js v14** with slash commands registered at the guild level via `deploy-commands.ts`. This script must be run manually after any command schema change — it is not run automatically on startup. Global command registration (all guilds) is intentionally not used; guild-level commands propagate instantly.

The bot requires the **Server Members Intent** (privileged) to call `guild.members.fetch()`. This must be enabled in the Discord Developer Portal under Bot → Privileged Gateway Intents.

---

## Runtime

- **Node.js v22 LTS** — do not downgrade; v22 is pinned in `.nvmrc`, `package.json` engines, Dockerfile, and CI.
- **Docker** — production deployment is always via `docker compose up -d`. The Dockerfile uses a multi-stage build; see `docs/agents/GOTCHAS.md` for why.
- **No HTTP server** — there is no Express or Fastify instance. The bot is purely event-driven via the Discord WebSocket gateway.
