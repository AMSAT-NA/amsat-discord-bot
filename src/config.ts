import 'dotenv/config';
import { z } from 'zod';

// ROLE_MAP maps WildApricot membership level names to Discord role IDs.
// Set this as a JSON string in your .env, e.g.:
//   ROLE_MAP={"Regular":"111222333","Family":"444555666","Life":"777888999"}
const roleMapSchema = z.string().transform((val, ctx) => {
  try {
    const parsed = JSON.parse(val);
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, string>;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ROLE_MAP must be a valid JSON object' });
    return z.NEVER;
  }
});

const configSchema = z.object({
  // ── Discord ────────────────────────────────────────────────────────────────
  DISCORD_TOKEN: z.string().min(1, 'Discord bot token is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'Discord application client ID is required'),
  DISCORD_GUILD_ID: z.string().min(1, 'Discord guild (server) ID is required'),
  /** Role ID that grants access to /admin commands */
  DISCORD_ADMIN_ROLE_ID: z.string().min(1, 'Admin role ID is required'),

  // ── WildApricot ────────────────────────────────────────────────────────────
  WILDAPRICOT_API_KEY: z.string().min(1, 'WildApricot API key is required'),
  // ── Amazon SES ─────────────────────────────────────────────────────────────
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS access key ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS secret access key is required'),
  AWS_REGION: z.string().default('us-east-1'),
  /** Must be a verified sender in SES (domain or address) */
  SES_FROM_ADDRESS: z.string().email('SES_FROM_ADDRESS must be a valid email'),
  SES_FROM_NAME: z.string().default('AMSAT Discord Bot'),

  // ── Role mapping ───────────────────────────────────────────────────────────
  ROLE_MAP: roleMapSchema,
  /** Optional role to assign to lapsed/expired members; leave blank to assign nothing */
  LAPSED_ROLE_ID: z.string().optional(),

  // ── Verification ───────────────────────────────────────────────────────────
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // ── Database ───────────────────────────────────────────────────────────────
  DATABASE_PATH: z.string().default('/data/bot.db'),

  // ── Scheduled sync ─────────────────────────────────────────────────────────
  /** node-cron expression. Default: 2:00 AM every day */
  SYNC_CRON: z.string().default('0 2 * * *'),

  // ── Logging ────────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌  Invalid configuration — fix the following before starting:\n');
    const fieldErrors = result.error.flatten().fieldErrors;
    for (const [field, messages] of Object.entries(fieldErrors)) {
      console.error(`  ${field}: ${messages?.join(', ')}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
