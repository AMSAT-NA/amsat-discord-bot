# Contributing to AMSAT Discord Bot

Thank you for your interest in contributing! This bot was built for the AMSAT community and we welcome improvements from fellow hams and developers.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/amsat-discord-bot.git`
3. Create a feature branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Open a pull request against `main`

## Development Setup

See the [Development section in the README](README.md#development) for full setup instructions. The short version:

```bash
npm install
cp .env.example .env   # fill in your values
npm run dev            # hot-reload dev server
```

## Code Standards

- **TypeScript** — all source files are `.ts`. Run `npm run typecheck` before submitting.
- **No secrets in source** — all configuration must come from environment variables defined in `src/config.ts`.
- **Ephemeral replies** — all bot replies to users should use `ephemeral: true` so membership info is never exposed to the channel.
- **Error handling** — every command handler has a top-level try/catch. Don't let unhandled promise rejections reach the Discord client.

## Adding a New Admin Subcommand

The `/admin` command is intentionally designed to be extended. To add a new subcommand:

1. Add a `.addSubcommand(...)` block to the `data` builder in `src/commands/admin.ts`
2. Add a `if (sub === 'your-command') await handleYourCommand(interaction);` line in `execute()`
3. Write the `async function handleYourCommand(...)` handler

## Adding Support for a New WildApricot Field

If you need to query or display additional WildApricot contact fields, add them to the `$select` parameter in `src/services/wildapricot.ts` and extend the `WildApricotContact` interface.

## CI/CD Secrets and Variables

The GitHub Actions pipeline requires the following configuration. Secrets are redacted in logs; variables are visible.

### Organisation Variables

Already configured at the AMSAT GitHub organisation level — no action needed:

| Name | Purpose |
|---|---|
| `AZURE_ACR_CLIENT_ID` | Service principal client ID with AcrPush (and implicit AcrPull) on `amsatorg` — used for both OIDC login in the push job and `docker login` in the deploy job |
| `AZURE_TENANT_ID` | Azure AD tenant |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription |
| `AZURE_ACR_NAME` | ACR registry name (no `.azurecr.io` suffix) |

### Repository Variables

Repo → Settings → Secrets and variables → Actions → **Variables**:

| Name | Example value | Purpose |
|---|---|---|
| `HOST_ADDRESS` | `your-server.example.com` | Deploy target hostname |
| `HOST_USER` | `deploy` | SSH user on the deploy target |
| `DISCORD_CLIENT_ID` | `1234567890` | Discord application (client) ID |
| `DISCORD_GUILD_ID` | `9876543210` | Discord server (guild) ID |
| `DISCORD_ADMIN_ROLE_ID` | `1111111111` | Role ID that grants `/admin` access |
| `AWS_REGION` | `us-east-1` | SES region |
| `SATELLITE_STATUS_API_CATALOG_ENDPOINT` | `https://amsat.org/status/api/catalog.php` | Full AMSAT status catalog endpoint used by `/tle` catalog features |
| `GP_TLE_URL` | `https://www.amsat.org/tle/current/nasabare.txt` | AMSAT TLE feed — "NASA bare" 3-line format used by `/tle get` |
| `GP_JSON_URL` | `https://newark192.amsat.org/gpdata/current/daily-bulletin.json` | AMSAT GP data feed — JSON orbital elements used by `/tle get` |
| `SES_FROM_ADDRESS` | `bot@amsat.org` | Verified SES sending address |
| `SES_FROM_NAME` | `AMSAT Discord Bot` | Display name for outbound email |
| `ROLE_MAP` | `{"Regular":"111","Life":"222"}` | WildApricot level → Discord role ID (JSON) |
| `LAPSED_ROLE_ID` | `3333333333` | Role for lapsed members (optional, leave blank) |
| `SYNC_CRON` | `0 2 * * *` | Nightly role-sync schedule (default: 2 AM UTC) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### Repository Secrets

Repo → Settings → Secrets and variables → Actions → **Secrets**:

| Name | Purpose |
|---|---|
| `HOST_DEPLOY_KEY` | ED25519 private key for SSH access to `HOST_ADDRESS` |
| `AZURE_ACR_CLIENT_SECRET` | Service principal client secret for ACR authentication |
| `DISCORD_TOKEN` | Discord bot token |
| `WILDAPRICOT_API_KEY` | WildApricot API key |
| `AWS_ACCESS_KEY_ID` | IAM key with `ses:SendEmail` permission |
| `AWS_SECRET_ACCESS_KEY` | Corresponding IAM secret |

The deploy job generates `/opt/services/amsat-discord-bot/.env` from these values on every push to `main`. No manual `.env` management is needed after the initial server setup.

See [docs/server-setup.md](docs/server-setup.md) for first-deploy instructions and how to generate the deploy key.

## Reporting Bugs

Please open a GitHub Issue with:
- What you expected to happen
- What actually happened
- Relevant log output (`docker compose logs bot`)
- Your Node.js and Docker versions

Do **not** include API keys, tokens, or Discord IDs in bug reports.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
