# AMSAT Discord Bot

[![CI](https://github.com/amsat/amsat-discord-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/amsat/amsat-discord-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)

A self-service Discord bot that lets AMSAT members verify their membership and receive the appropriate Discord role automatically — without any admin intervention.

Members run `/verify start`, receive a one-time code at their WildApricot email address, then run `/verify confirm` to complete verification and get their role. Roles are re-synced nightly to stay current with WildApricot.

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [1. Discord Application](#1-discord-application)
  - [2. WildApricot API Key](#2-wildapricot-api-key)
  - [3. Amazon SES](#3-amazon-ses)
  - [4. Role Mapping](#4-role-mapping)
- [Configuration Reference](#configuration-reference)
- [Running with Docker](#running-with-docker)
- [GitHub Actions / CI](#github-actions--ci)
- [Development](#development)
- [Commands Reference](#commands-reference)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Self-service verification** — members verify themselves; no admin needed
- **Email OTP** — one-time codes sent via Amazon SES; codes are hashed before storage
- **Automatic role assignment** — roles mapped to WildApricot membership levels
- **Nightly sync** — scheduled job keeps roles current as memberships renew or lapse
- **Admin commands** — callsign lookup, bulk resync, and user unlinking
- **Fully ephemeral** — all bot replies are private to the user who ran the command
- **Dockerized** — single `docker compose up -d` deployment
- **All secrets via environment** — safe for GitHub Actions, Docker secrets, and CI/CD

---

## How It Works

```
Member: /verify start email:w1aw@example.com
  │
  ├─► Bot queries WildApricot API for that email
  │     Not found? ──► Error message (ephemeral)
  │
  ├─► Bot generates 6-digit OTP, stores SHA-256 hash in SQLite
  │
  └─► Bot sends OTP to email via Amazon SES

Member: /verify confirm code:482910
  │
  ├─► Bot checks OTP hash, expiry, and attempt count
  │     Invalid/expired? ──► Error message (ephemeral)
  │
  ├─► Bot fetches fresh membership data from WildApricot
  │
  ├─► Bot assigns Discord role based on ROLE_MAP
  │
  └─► Verification stored in SQLite; OTP session deleted

Nightly (SYNC_CRON):
  └─► Bot re-fetches every verified member from WildApricot
        and updates their Discord role to match current status
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Docker + Docker Compose | v2.x recommended |
| Discord application & bot token | [Developer Portal](https://discord.com/developers/applications) |
| WildApricot admin account | API key from Settings → Authorized Applications |
| Amazon SES account | Verified sending identity (domain or address) |

---

## Setup

### 1. Discord Application

#### Create the bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Give it a name (e.g. `AMSAT Bot`) and click **Create**.
3. In the left sidebar, click **Bot**.
4. Click **Reset Token**, copy the token → `DISCORD_TOKEN`
   > ⚠️ This is only shown once. Store it securely.
5. Under **Privileged Gateway Intents**, enable **Server Members Intent**. This is required for the bot to fetch guild members.
6. Copy the **Application ID** from the General Information page → `DISCORD_CLIENT_ID`

#### Invite the bot to your server

1. In the left sidebar, click **OAuth2 → URL Generator**.
2. Under **Scopes**, select `bot` and `applications.commands`.
3. Under **Bot Permissions**, select **Manage Roles**.
4. Copy the generated URL and open it in your browser to invite the bot to your server.

#### Get your server and role IDs

Enable **Developer Mode** in Discord: User Settings → Advanced → Developer Mode.

- **Server ID**: Right-click your server icon → Copy Server ID → `DISCORD_GUILD_ID`
- **Admin Role ID**: Server Settings → Roles → right-click your admin role → Copy Role ID → `DISCORD_ADMIN_ROLE_ID`
- **Membership Role IDs**: Same process for each membership role → used in `ROLE_MAP`

#### Set the role hierarchy

> ⚠️ **Critical step.** Discord will refuse to assign roles ranked higher than the bot's own role.

Go to **Server Settings → Roles** and drag the bot's role (named after your application) **above** all membership roles it needs to assign.

---

### 2. WildApricot API Key

1. Log in to WildApricot as an administrator.
2. Go to **Settings → Authorized applications**.
3. Click **Developer access** and generate an API key → `WILDAPRICOT_API_KEY`
4. Find your **Account ID**:
   - Go to **Settings → Account**
   - The account ID is the number in the page URL, e.g. `wildapricot.com/admin/account/**123456**`
   - → `WILDAPRICOT_ACCOUNT_ID`

---

### 3. Amazon SES

#### Verify your sending identity

1. In the AWS console, navigate to **Simple Email Service (SES)**.
2. Go to **Verified identities** and click **Create identity**.
3. Choose **Domain** (recommended) or **Email address** and complete verification.
4. Set `SES_FROM_ADDRESS` to an address at your verified domain/identity.

> If your account is in the **SES sandbox**, you can only send to verified addresses. [Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) before going live.

#### Create an IAM user

1. In the AWS console, go to **IAM → Users → Create user**.
2. Attach the following inline policy (replace the ARN with your verified identity's ARN):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:YOUR_ACCOUNT_ID:identity/yourdomain.org"
    }
  ]
}
```

3. Go to the user → **Security credentials → Create access key** → use case: **Application running outside AWS**.
4. Copy the key pair → `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`

---

### 4. Role Mapping

The `ROLE_MAP` environment variable tells the bot which Discord role to assign for each WildApricot membership level.

**Step 1:** Find your exact membership level names in WildApricot:
- Go to **Members → Membership levels**
- Note the exact names, including capitalization and spaces

**Step 2:** Find the Discord role IDs for each level (see [Get your server and role IDs](#get-your-server-and-role-ids) above).

**Step 3:** Build a JSON object mapping level names to role IDs:

```bash
# In your .env file:
ROLE_MAP={"Regular":"111111111111111111","Family":"222222222222222222","Life":"333333333333333333","Associate":"444444444444444444"}
```

> The level names must **exactly** match WildApricot — including capitalization. If a member has a level that isn't in the map, the bot will log a warning and not assign any role.

**Optional — lapsed member role:**
If you want lapsed/expired members to receive a specific "Lapsed" role instead of having all roles removed:
```bash
LAPSED_ROLE_ID=555555555555555555
```

---

## Configuration Reference

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in your values.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | ✅ | — | Application ID from the Discord Developer Portal |
| `DISCORD_GUILD_ID` | ✅ | — | Your Discord server (guild) ID |
| `DISCORD_ADMIN_ROLE_ID` | ✅ | — | Role ID that grants access to `/admin` commands |
| `WILDAPRICOT_API_KEY` | ✅ | — | WildApricot API key |
| `WILDAPRICOT_ACCOUNT_ID` | ✅ | — | WildApricot numeric account ID |
| `AWS_ACCESS_KEY_ID` | ✅ | — | AWS IAM access key ID |
| `AWS_SECRET_ACCESS_KEY` | ✅ | — | AWS IAM secret access key |
| `AWS_REGION` | — | `us-east-1` | AWS region for SES |
| `SES_FROM_ADDRESS` | ✅ | — | Verified SES sender email address |
| `SES_FROM_NAME` | — | `AMSAT Discord Bot` | Display name for outgoing emails |
| `ROLE_MAP` | ✅ | — | JSON object: WildApricot level name → Discord role ID |
| `LAPSED_ROLE_ID` | — | *(none)* | Discord role ID assigned to lapsed members |
| `OTP_TTL_MINUTES` | — | `15` | How long a verification code remains valid |
| `OTP_MAX_ATTEMPTS` | — | `5` | Failed attempts before a code is invalidated |
| `SYNC_CRON` | — | `0 2 * * *` | Cron schedule for nightly role sync (UTC) |
| `DATABASE_PATH` | — | `/data/bot.db` | Path to the SQLite database file |
| `LOG_LEVEL` | — | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

> **Never commit your `.env` file.** It is listed in `.gitignore`. Use GitHub Secrets or your hosting provider's secret management for production deployments.

---

## Running with Docker

### Production

```bash
# 1. Clone the repository
git clone https://github.com/amsat/amsat-discord-bot.git
cd amsat-discord-bot

# 2. Configure environment
cp .env.example .env
# Edit .env with your values — see Configuration Reference above

# 3. Build the image
docker compose build

# 4. Register slash commands with Discord (run once, or after any command changes)
docker compose run --rm bot node dist/deploy-commands.js

# 5. Start the bot
docker compose up -d

# View live logs
docker compose logs -f

# Stop the bot
docker compose down
```

The bot's SQLite database is stored in a named Docker volume (`bot-data`) that persists across restarts and image rebuilds.

### Updating

```bash
git pull
docker compose build
docker compose up -d
```

If you've added or changed any slash commands, re-run the deploy step:
```bash
docker compose run --rm bot node dist/deploy-commands.js
```

---

## GitHub Actions / CI

The included `.github/workflows/ci.yml` runs on every push to `main` and on pull requests. It:

1. Runs TypeScript typechecking (`npm run typecheck`)
2. Compiles the project (`npm run build`)
3. Builds the Docker image to catch any container issues

### Using GitHub Secrets for deployment

If you're deploying from GitHub Actions or just want to keep secrets out of any `.env` file on your server, add all required variables as **Repository Secrets** in your GitHub repo:

**Settings → Secrets and variables → Actions → New repository secret**

Add each variable from the [Configuration Reference](#configuration-reference) table. Then on your server you can pass them directly to Docker Compose via environment rather than a `.env` file:

```bash
# On the server, export each secret then run:
docker compose up -d
```

Or use a CI/CD pipeline that writes secrets to `.env` at deploy time.

---

## Development

### Local setup (without Docker)

```bash
npm install
cp .env.example .env   # fill in your values

# Register slash commands
npm run deploy-commands

# Start with hot reload
npm run dev
```

### Local setup (with Docker hot reload)

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up
```

Source changes under `src/` are picked up automatically without rebuilding the image.

### Useful scripts

| Script | Description |
|---|---|
| `npm run dev` | Start with hot reload (ts-node-dev) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |
| `npm run typecheck` | Type-check without emitting files |
| `npm run deploy-commands` | Register slash commands with Discord |

### Project structure

```
src/
├── commands/
│   ├── verify.ts        # /verify start and /verify confirm
│   ├── membership.ts    # /membership
│   ├── admin.ts         # /admin lookup | resync | unlink
│   └── index.ts         # Command registry
├── services/
│   ├── wildapricot.ts   # WildApricot API client (token caching, contact lookup)
│   └── email.ts         # Amazon SES email sending
├── db/
│   └── index.ts         # SQLite schema, prepared statements, typed interfaces
├── utils/
│   ├── otp.ts           # OTP generation and SHA-256 hashing
│   ├── roles.ts         # Discord role assignment logic
│   └── logger.ts        # Structured console logger
├── config.ts            # Zod-validated environment configuration
├── sync.ts              # Nightly cron job
├── deploy-commands.ts   # One-time slash command registration script
└── index.ts             # Entry point — Discord client, event handlers
```

---

## Commands Reference

All bot replies are **ephemeral** — only visible to the person who ran the command.

### Member commands

#### `/verify start email:<address>`

Begins the verification flow. The bot looks up the email in WildApricot and sends a 6-digit one-time code to that address via Amazon SES.

- The email must match the address on the member's WildApricot account
- An in-progress verification session expires after `OTP_TTL_MINUTES` (default 15 minutes)
- Running `/verify start` again replaces any existing pending session

#### `/verify confirm code:<code>`

Completes verification. The bot validates the OTP, fetches fresh membership data from WildApricot, and assigns the appropriate Discord role.

- Codes are invalidated after `OTP_MAX_ATTEMPTS` failed attempts (default 5)
- On success, the member's WildApricot contact ID is stored so future syncs can use it

#### `/membership`

Shows the member's current membership status and refreshes their Discord role. Useful if a membership renewal hasn't been reflected yet.

---

### Admin commands

Admin commands require the caller to hold the role configured in `DISCORD_ADMIN_ROLE_ID`.

#### `/admin lookup callsign:<callsign>`

Searches WildApricot for a callsign and returns membership details. Read-only — no Discord roles are changed. This is the self-service replacement for the original admin-only `!verify` command.

- Uses WildApricot's `simpleQuery` (broad text search across all fields)
- Returns up to 5 matches if the callsign appears in multiple records

#### `/admin resync`

Re-syncs every verified member's Discord role against their current WildApricot membership status. Useful after bulk membership changes or to fix any drift.

Reports: total records, synced, role changes made, members no longer in the server, and errors.

#### `/admin unlink user:<@user>`

Removes the WildApricot link for a Discord user, allowing them to re-verify with a different email. Does **not** automatically remove their Discord roles — do that manually if needed.

---

## Architecture

### Database (SQLite)

Two tables, stored in a Docker volume at `/data/bot.db`:

**`verified_members`** — One row per verified Discord user.

| Column | Type | Description |
|---|---|---|
| `discord_id` | TEXT PK | Discord user snowflake ID |
| `wildapricot_contact_id` | INTEGER | WildApricot contact record ID |
| `email` | TEXT UNIQUE | Email address used during verification |
| `membership_level` | TEXT | WildApricot membership level name at last sync |
| `membership_status` | TEXT | Active / Lapsed / PendingRenewal / etc. |
| `verified_at` | TEXT | When the user first verified |
| `last_synced_at` | TEXT | When the record was last refreshed |

**`pending_verifications`** — Temporary OTP sessions, one per Discord user.

| Column | Type | Description |
|---|---|---|
| `discord_id` | TEXT PK | Discord user snowflake ID |
| `email` | TEXT | Email the OTP was sent to |
| `otp_hash` | TEXT | SHA-256 hash of the OTP (plaintext never stored) |
| `expires_at` | INTEGER | Unix timestamp (seconds) of expiry |
| `attempts` | INTEGER | Number of failed confirm attempts |

### WildApricot API

The bot uses WildApricot's REST API v2.2 with OAuth2 client credentials flow. The access token is cached in memory and refreshed automatically before expiry.

- **Token endpoint:** `https://oauth.wildapricot.org/auth/token`
- **Contacts by email:** `GET /v2.2/Accounts/{id}/Contacts?$filter=Email eq '{email}'`
- **Contact by ID:** `GET /v2.2/Accounts/{id}/Contacts/{contactId}`
- **Callsign search:** `GET /v2.2/Accounts/{id}/Contacts?simpleQuery={callsign}`

### Security notes

- OTP codes are **SHA-256 hashed** before storage. The plaintext is never written to the database.
- All Discord replies use `ephemeral: true` — membership details are never visible to the channel.
- Email hijacking is prevented: a second Discord user cannot claim an email already linked to another account.
- The bot runs as a **non-root user** inside Docker.
- `DISCORD_ADMIN_ROLE_ID` is checked in application code as a second layer, even though `setDefaultMemberPermissions` provides Discord-level UI protection.

---

## Troubleshooting

### Bot is online but slash commands don't appear

Run the deploy-commands script and wait up to a minute for Discord to propagate:
```bash
docker compose run --rm bot node dist/deploy-commands.js
```

### "Missing Permissions" error when assigning roles

The bot's role in Discord must be ranked **above** all membership roles in the server hierarchy. Go to **Server Settings → Roles** and drag the bot's role higher.

### "No active membership found" for a valid member

Check that the email the member used exactly matches what's in WildApricot (including any aliases). You can use `/admin lookup callsign:THEIR_CALLSIGN` to find their record and confirm the correct email.

### OTP emails not arriving

1. Check that your SES sending identity is verified and not in sandbox mode.
2. Check the bot logs for SES errors: `docker compose logs bot | grep -i ses`
3. Confirm `SES_FROM_ADDRESS` matches your verified identity.

### Membership level not mapping to a role

The bot logs a warning when a level name isn't in `ROLE_MAP`. Check:
```bash
docker compose logs bot | grep "No Discord role mapped"
```
Then compare the logged level name against your `ROLE_MAP` keys — they must match exactly.

### View all logs

```bash
docker compose logs -f bot
```

For debug-level output, set `LOG_LEVEL=debug` in your `.env` and restart.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © AMSAT — The Radio Amateur Satellite Corporation
