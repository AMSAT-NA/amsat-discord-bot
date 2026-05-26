# Integrations

Details on each external service the bot depends on — API behaviour, auth flows, known quirks, and configuration requirements.

---

## WildApricot

**API version:** v2.2  
**Base URL:** `https://api.wildapricot.org/v2.2`  
**Auth URL:** `https://oauth.wildapricot.org`  
**Docs:** https://app.wildapricot.org/api/doc/v2.2

### Authentication

WildApricot uses OAuth2 client credentials flow. The API key is passed as HTTP Basic auth with the literal string `APIKEY` as the username:

```
Authorization: Basic base64("APIKEY:<api_key>")
```

The token endpoint returns an `access_token` and `expires_in` (seconds). The bot caches this token in memory in `wildapricot.ts` and refreshes it 60 seconds before expiry. The token is not persisted to the database.

### Contact lookup by email

Uses an ODATA `$filter` for an exact match:

```
GET /Accounts/{id}/Contacts?$filter=Email eq '{email}'&$async=false
```

The `$async=false` parameter is required — without it WildApricot may return a job ID instead of results.

### Contact lookup by callsign

Uses `simpleQuery` for a broad free-text search across all fields:

```
GET /Accounts/{id}/Contacts?simpleQuery={callsign}&$async=false
```

This can return multiple results if the callsign string appears in any field (address, notes, etc.). The `/admin lookup` command surfaces all matches rather than silently taking the first result.

### Membership level names

The `ROLE_MAP` config keys must **exactly match** the `MembershipLevel.Name` string returned by the API, including capitalisation and spaces. To find the correct strings, either:
- Run `/admin lookup` on a known member and check the logs
- Go to WildApricot admin → Members → Membership levels

### Contact status values

| Status | Meaning |
|---|---|
| `Active` | Full member in good standing |
| `PendingRenewal` | Grace period — treated as active by `isActiveMember()` |
| `Lapsed` | Membership expired |
| `PendingNew` | Application submitted, not yet approved |
| `Suspended` | Manually suspended by admin |

`isActiveMember()` in `wildapricot.ts` returns true for `Active` and `PendingRenewal`. All other statuses are treated as inactive and receive the `LAPSED_ROLE_ID` role (if configured) or no role.

### MembershipLevel can be null

Contacts without a membership level (e.g. non-member contacts in WildApricot) have `MembershipLevel: null`. All code that accesses `contact.MembershipLevel.Name` must use optional chaining: `contact.MembershipLevel?.Name ?? 'Unknown'`.

---

## Amazon SES

**SDK:** `@aws-sdk/client-ses` (AWS SDK v3)  
**Region:** Configurable via `AWS_REGION` (default `us-east-1`)

### IAM permissions required

The IAM user needs only `ses:SendEmail` scoped to the verified sending identity:

```json
{
  "Effect": "Allow",
  "Action": "ses:SendEmail",
  "Resource": "arn:aws:ses:us-east-1:ACCOUNT_ID:identity/yourdomain.org"
}
```

Do not grant `ses:SendRawEmail` or broader SES permissions — the bot only needs `SendEmail`.

### Sandbox mode

New SES accounts are in sandbox mode and can only send to verified addresses. This will cause verification emails to silently fail to deliver in testing unless the recipient address is also verified. Request production access before go-live.

### From address

`SES_FROM_ADDRESS` must match the verified sending identity exactly. If you verified a domain (`yourdomain.org`), any address at that domain works. If you verified a specific address, it must match exactly.

### Email templates

Both HTML and plaintext versions are sent with every OTP email, built in `src/services/email.ts`. The OTP code and TTL are embedded directly in the template. If the email templates need updating, both `buildHtml()` and `buildText()` functions must be kept in sync.

---

## Discord

**Library:** discord.js v14  
**Docs:** https://discord.js.org / https://discord.com/developers/docs

### Required bot permissions

| Permission | Why |
|---|---|
| `Manage Roles` | Assign and remove membership roles |
| `Server Members Intent` (privileged) | Required to call `guild.members.fetch()` |

The Server Members Intent must be enabled in the Discord Developer Portal under **Bot → Privileged Gateway Intents**. The bot will connect without it but `guild.members.fetch()` will throw.

### Role hierarchy — critical

Discord enforces that a bot can only assign roles ranked **below** its own role in the server hierarchy. If a membership role is ranked above the bot's role, `member.roles.add()` will throw a `DiscordAPIError[50013]: Missing Permissions` error. This does not produce a visible error to the user — only a log entry.

**Fix:** Server Settings → Roles → drag the bot's role above all membership roles.

### Slash command registration

Slash commands are registered at the guild level by running `deploy-commands.ts`. This must be run:
- On first deployment
- Any time a command name, description, or option changes
- After adding a new command or subcommand

It does **not** run automatically on bot startup. Guild-level commands propagate instantly. Global commands (not used here) take up to 1 hour.

### Ephemeral replies

All replies use `ephemeral: true`. An ephemeral reply requires that `deferReply({ ephemeral: true })` was called first — if `deferReply()` was called without `ephemeral: true`, the follow-up `editReply()` will also be public. Always set ephemeral on the defer, not just the reply.

### Interaction timeout

Discord requires an initial response within 3 seconds. All handlers call `interaction.deferReply()` immediately before any async work. The deferred state keeps the interaction alive for up to 15 minutes.
