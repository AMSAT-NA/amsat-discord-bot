# Conventions

Patterns and standards used throughout the codebase. Follow these when adding or modifying code.

---

## TypeScript

- **Strict mode is on.** `tsconfig.json` has `"strict": true`. All types must be explicit or properly inferred. Do not use `any` — use `unknown` and narrow it.
- **No `declaration: true` in tsconfig.** This is an application, not a published library. Declaration files serve no purpose here and cause TS4023 errors with `better-sqlite3`'s internal types.
- **No implicit globals.** Every variable must be declared with `const` or `let`. The original bot this replaced used implicit globals which caused race conditions under concurrent use.
- **Async/await throughout.** No raw `.then()` chains. All Discord command handlers are `async` functions.

---

## Command Handlers

Every command file exports at least:

```typescript
export const data: SlashCommandBuilder = ...   // command schema
export async function execute(interaction: ChatInputCommandInteraction): Promise<void>
```

Commands that use slash-option autocomplete may also export:

```typescript
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void>
```

Commands are registered in `src/commands/index.ts` by importing the module and calling `commands.set(cmd.data.name, cmd)`. Adding a new command means creating the file and adding one import + one set call there.

### Deferred replies

Every command handler that does any async work (API call, DB query) must defer the reply immediately:

```typescript
await interaction.deferReply({ ephemeral: true });
// ... async work ...
await interaction.editReply({ ... });
```

The `ephemeral: true` on the defer is mandatory — see Architecture doc.

### Error handling

Every command handler has a top-level try/catch that calls `interaction.editReply()` with a generic error message. Do not let exceptions propagate to the client-level error handler in `index.ts` from a command — that handler is a last resort, not the primary path.

---

## Database (SQLite)

All database access goes through the prepared statements exported from `src/db/index.ts`. Do not write inline SQL in command handlers or services.

```typescript
// ✅ correct
const record = statements.getVerifiedMember.get(discordId);

// ❌ wrong — SQL in a command handler
const record = db.prepare('SELECT * FROM verified_members WHERE discord_id = ?').get(discordId);
```

When adding a new query, add a typed prepared statement to the `statements` object in `db/index.ts`.

`better-sqlite3` is synchronous. Do not wrap its calls in `Promise` or `async` — they are not async operations and don't need to be.

---

## WildApricot API

All WildApricot calls go through `src/services/wildapricot.ts`. Do not call the WildApricot API directly from command handlers.

The access token is cached in a module-level variable. Do not add a second token cache elsewhere.

When adding a new WildApricot query, add the field to the `$select` parameter and extend the `WildApricotContact` interface in `wildapricot.ts`.

---

## Environment & Configuration

All configuration is sourced from environment variables and validated in `src/config.ts` using Zod. The rules:

1. **No hardcoded values** that could vary between environments (IDs, keys, URLs, timing).
2. **Add to `.env.example`** whenever a new variable is added to the schema.
3. **Provide a sensible default** via `.default()` in the Zod schema for optional settings.
4. **Fail fast** — Zod exits the process at startup if required vars are missing. Do not add `|| fallback` patterns that silently swallow missing config.

---

## Logging

Use the logger from `src/utils/logger.ts` — do not use `console.log` directly.

```typescript
import { logger } from '../utils/logger';

logger.debug('Detailed info useful during development', { someContext });
logger.info('Normal operational event', { discordId, email });
logger.warn('Something unexpected but recoverable', { level, availableKeys });
logger.error('Something failed', { err, discordId });
```

Always pass structured metadata as the second argument rather than interpolating into the message string. This makes logs grep-friendly and parseable.

Log levels by use:
- `debug` — only visible when `LOG_LEVEL=debug`; use freely for development tracing
- `info` — significant lifecycle events (bot ready, member verified, sync complete)
- `warn` — unexpected state that didn't cause a failure (unmapped role, missing guild member)
- `error` — caught exceptions and failures

---

## Dockerfile / Build

The Dockerfile uses a **two-stage build**:

1. **builder** — installs all deps (including dev), compiles TypeScript, prunes dev deps. Has `python3 make g++` for native module compilation.
2. **production** — copies `node_modules` and `dist/` from builder. No build tools.

Do not add `RUN npm install` or `RUN npm ci` to the production stage. Native modules compiled in the builder stage are binary-compatible because both stages share the same `node:22-alpine` base image.

---

## Admin Commands

The `/admin` command is the extension point for operator tooling. When adding admin subcommands:

1. Add `.addSubcommand(...)` to the builder in `admin.ts`
2. Add `if (sub === 'your-command') await handleYourCommand(interaction);` in `execute()`
3. Write `async function handleYourCommand(...)` in the same file
4. The admin role check at the top of `execute()` applies to all subcommands automatically
