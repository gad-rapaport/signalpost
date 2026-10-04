import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const list = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3105),
    DATABASE_PATH: z.string().default('data/signalpost.db'),
    BACKUP_DIR: z.string().default('backups'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    COOKIE_SECURE: bool.default(false),
    TRUST_PROXY: bool.default(false),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
    APP_TIMEZONE: z.string().default('Asia/Jerusalem'),
    STATUS_TITLE: z.string().min(1).max(80).default('Signalpost demo status'),

    // Outbound policy: what monitors (and the webhook) may contact.
    /** Hostnames monitors may target: exact names, or "*.example.org" for subdomains. Empty = nothing. */
    ALLOWED_HOSTS: list,
    /** Exact hostnames allowed to resolve to private addresses (demo targets on an internal network). */
    ALLOW_PRIVATE_HOSTS: list,
    ALLOWED_PORTS: z
      .string()
      .default('80,443')
      .transform((s) => s.split(',').map((x) => Number(x.trim())))
      .pipe(z.array(z.number().int().min(1).max(65535)).min(1)),

    // Scheduler.
    SCHEDULER_ENABLED: bool.default(true),
    MAX_CONCURRENT_CHECKS: z.coerce.number().int().min(1).max(32).default(4),
    MIN_INTERVAL_S: z.coerce.number().int().min(5).max(3600).default(30),
    RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    // Optional integrations; both off unless configured.
    METRICS_TOKEN: z.string().min(24, 'METRICS_TOKEN must be at least 24 characters').optional(),
    WEBHOOK_URL: z.string().url().optional(),
    WEBHOOK_SECRET: z.string().min(32, 'WEBHOOK_SECRET must be at least 32 characters').optional(),

    // Demo target (the demo-api container) and seed.
    DEMO_CONTROL_TOKEN: z.string().min(16).optional(),
    SEED_ADMIN_EMAIL: z.string().email().default('admin@signalpost.test'),
    SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.WEBHOOK_URL && !c.WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['WEBHOOK_SECRET'], message: 'required when WEBHOOK_URL is set' });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Empty strings in .env mean "not set".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: parsed.data.APP_TIMEZONE });
  } catch {
    throw new Error(`Invalid configuration: APP_TIMEZONE "${parsed.data.APP_TIMEZONE}" is not an IANA zone`);
  }
  return parsed.data;
}
