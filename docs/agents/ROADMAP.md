# Roadmap

Planned features, known gaps, and ideas for future development. Items are not prioritised — this is a reference for agents and contributors, not a sprint plan.

---

## Planned Features

### `/admin stats`
Return a summary of verified members by membership level and status. Useful for a quick health check without querying WildApricot directly.

Suggested output:
- Total verified Discord members
- Breakdown by membership level
- Count of lapsed members still in the server
- Last sync timestamp

### `/admin force-verify user:@someone email:address`
Allow an admin to manually link a Discord user to a WildApricot email and assign their role, bypassing the OTP flow. Useful for members who can't receive email at their WildApricot address.

Should still query WildApricot to confirm the email exists and fetch the membership level — do not allow admins to assign arbitrary roles.

### Re-verification prompt for lapsed members
When the nightly sync detects a member has lapsed, optionally send them a Discord DM notifying them their role has been removed and linking to the renewal page. Requires the `Direct Messages` intent and should be opt-in via config.

### Webhook or WildApricot integration for real-time sync
WildApricot supports webhooks for membership events (renewal, new member, etc.). Implementing a listener would allow role updates within seconds of a membership change rather than waiting for the nightly cron.

Requires exposing an HTTPS endpoint — would need a reverse proxy (Caddy, nginx) in front of the bot or a separate webhook handler service.

### Per-guild configuration
Currently the bot supports a single Discord guild. Supporting multiple guilds would require moving configuration (ROLE_MAP, DISCORD_GUILD_ID, etc.) into the database rather than environment variables.

---

## Known Gaps

### No audit log
Role assignments and verifications are logged to stdout but not persisted in a searchable format. An audit table in SQLite (`role_changes`) would help with debugging and compliance.

### No rate limiting on `/verify start`
A user can call `/verify start` repeatedly, generating multiple SES sends. The `upsertPendingVerification` replaces the previous session so only one code is ever valid, but there is no throttle on email sends. Consider adding a cooldown check (e.g. cannot re-request within 5 minutes).

### OTP is purely numeric
The 6-digit numeric OTP is convenient but provides 1-in-900,000 guessing odds with a 15-minute window. `OTP_MAX_ATTEMPTS` (default 5) limits brute-force attempts. If stronger OTPs are needed, `otp.ts` can be updated to use alphanumeric codes — the hash and verify functions are format-agnostic.

### No handling for WildApricot API downtime
If WildApricot is unreachable during `/verify confirm`, the user sees a generic error. A retry with backoff or a clearer "WildApricot is currently unavailable" message would improve the experience.

### Members who leave and rejoin Discord
If a verified member leaves the Discord server, their record remains in `verified_members`. When they rejoin they won't automatically receive their role — they must run `/membership` or wait for the next nightly sync to trigger `guild.members.fetch()` successfully.

### No test suite
There are currently no unit or integration tests. The most valuable tests to add first would be:
- `otp.ts` — `generateOtp`, `hashOtp`, `verifyOtp`
- `roles.ts` — `applyMembershipRole` with mocked Discord members
- `wildapricot.ts` — mocked API responses for each lookup function

---

## Deferred Decisions

### Switching from `better-sqlite3` to a pure-JS SQLite driver
`better-sqlite3` is a native module that requires compilation during Docker builds (see `GOTCHAS.md`). A pure-JS alternative (`sql.js`, `@sqlite.org/sqlite-wasm`) would simplify the Dockerfile but may have performance or API differences. Not worth the migration unless the native build causes ongoing pain.

### Moving to ESM
The project uses CommonJS (`"module": "commonjs"` in tsconfig). Migrating to ESM would align with the direction of the Node.js ecosystem but requires changes to imports, the build config, and potentially some dependencies. Low priority.
