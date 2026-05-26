# Gotchas

Things that caused real problems during development and setup. Read this before debugging a build or deployment issue.

---

## Docker

### `better-sqlite3` fails to build in the production stage

**Symptom:**
```
npm error gyp ERR! find Python You need to install the latest version of Python.
npm error gyp ERR! not ok
```

**Cause:** `better-sqlite3` is a native Node.js module that compiles C++ via `node-gyp` during `npm install`. Alpine Linux doesn't include Python, `make`, or `g++` by default.

**Fix:** The Dockerfile uses a two-stage build. The builder stage installs `python3 make g++` via apk and compiles the native binary. The production stage copies `node_modules` from the builder — no recompilation needed since both stages use the same `node:22-alpine` base.

Do not add `npm install` or `npm ci` to the production stage. The compiled `.node` binary must come from the builder.

### GitHub Actions `ci.yml` must be in `.github/workflows/`

**Symptom:** Workflow file exists in repo but Actions never triggers.

**Cause:** GitHub only scans `.github/workflows/` for workflow files. A `ci.yml` in the repo root is ignored entirely.

**Fix:** File path must be `.github/workflows/ci.yml`.

---

## Node.js & npm

### `npm ci` fails with "lock file not found"

**Symptom:**
```
Error: Dependencies lock file is not found. Supported file patterns: package-lock.json
```

**Cause:** `npm ci` requires a `package-lock.json` to exist. If the lock file was never committed to the repo, CI has nothing to install from.

**Fix:** Run `npm install` locally to generate `package-lock.json`, then commit it. The lock file should always be committed for applications (not libraries).

### `actions/setup-node@v4` with `cache: 'npm'` also requires the lock file

**Cause:** The `cache: 'npm'` option in `setup-node` uses the lock file as the cache key. If it doesn't exist, the action fails before `npm install` even runs.

**Fix:** Either commit the lock file (preferred), or remove `cache: 'npm'` from the action config.

### Node v23 causes peer dependency errors

**Cause:** Node v23 is an odd-numbered "current" release, not LTS. Some packages explicitly exclude it from their peer dependency ranges.

**Fix:** Use Node v22 LTS. The project pins v22 in `.nvmrc`, `package.json` engines, Dockerfile, and CI. Use `nvm install 22 && nvm use 22` locally.

---

## TypeScript

### TS4023: Exported variable has or is using name from external module

**Symptom:**
```
error TS4023: Exported variable 'db' has or is using name 'BetterSqlite3.Database'
from external module but cannot be named.
```

**Cause:** `tsconfig.json` had `"declaration": true`, which tells TypeScript to generate `.d.ts` type declaration files. When it tries to generate declarations for the `db` and `statements` exports, it can't write out the `better-sqlite3` internal types by name.

**Fix:** Remove `"declaration": true` from `tsconfig.json`. This project is an application, not a published npm library. Declaration files serve no purpose here.

### `@typescript-eslint` v7 is incompatible with ESLint v9

**Symptom:**
```
npm error peer eslint@"^8.56.0" from @typescript-eslint/parser@7.x
```

**Cause:** `@typescript-eslint` v7 only supports ESLint v8. ESLint v9 requires `@typescript-eslint` v8.

**Fix:** Bump `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` to `^8.0.0` in `package.json`.

---

## GitHub Actions

### `actions/checkout@v4` and `actions/setup-node@v4` use Node 20

GitHub deprecated Node 20 as the actions runtime with a forced migration deadline of **June 16, 2026**. Actions pinned to `@v4` will break after that date.

**Fix:** Use `actions/checkout@v5` and `actions/setup-node@v5`, which run on Node 24 internally. The `node-version` input is independent — you can still set `node-version: '22'` to install Node 22 for your build steps.

---

## Discord

### Bot can't assign roles — "Missing Permissions"

**Symptom:** `applyMembershipRole()` throws `DiscordAPIError[50013]`. Users verify successfully but receive no role.

**Cause:** Discord enforces that a bot can only manage roles ranked below its own role in the server hierarchy.

**Fix:** Server Settings → Roles → drag the bot's role above all membership roles it needs to assign.

### Slash commands don't appear in Discord after deployment

**Cause:** `deploy-commands.ts` was not run after the commands were changed, or it was run against a different guild ID than the server being used.

**Fix:** Run `docker compose run --rm bot node dist/deploy-commands.js` and confirm the guild ID in `.env` matches the server.

### Membership level not mapping to a role despite correct config

**Cause:** The `ROLE_MAP` key doesn't exactly match the `MembershipLevel.Name` string returned by WildApricot. Common issues: extra spaces, different capitalisation, a level name that changed in WildApricot.

**Fix:** Check the logs for `"No Discord role mapped for WildApricot membership level"` — the log entry includes the exact level name string being returned. Compare that against your `ROLE_MAP` keys.

---

## WildApricot

### OTP email sent but membership lookup fails on confirm

**Cause:** The bot looks up the contact by email on both `/verify start` (to send the OTP) and `/verify confirm` (to get fresh data). If the membership record is deleted or the email changes between the two calls, the second lookup returns null.

**Expected behaviour:** The pending verification session is deleted and the user sees an error asking them to contact an admin.

### `simpleQuery` returns unexpected results

**Cause:** `simpleQuery` is a broad free-text search across all WildApricot fields. A callsign that appears in a member's address, notes, or any other text field will also match.

**Expected behaviour:** `/admin lookup` shows up to 5 matches and includes all returned results so the admin can identify the correct record.
