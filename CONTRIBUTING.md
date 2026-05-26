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

## Reporting Bugs

Please open a GitHub Issue with:
- What you expected to happen
- What actually happened
- Relevant log output (`docker compose logs bot`)
- Your Node.js and Docker versions

Do **not** include API keys, tokens, or Discord IDs in bug reports.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
