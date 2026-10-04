import { loadConfig } from './config.js';
import { migrate, openDb } from './db/db.js';
import { runRetention } from './monitor/retention.js';
import { createRuntime } from './runtime.js';

const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
const applied = migrate(db);
const { app, scheduler, metrics } = await createRuntime(config, db);
if (applied.length) app.log.info({ applied }, 'migrations applied');

const retention = () => {
  try {
    const r = runRetention(db, config.RETENTION_DAYS, config.APP_TIMEZONE, Date.now(), metrics);
    app.log.info({ retention: r }, 'retention run');
  } catch (err) {
    app.log.error({ err }, 'retention failed');
  }
};
retention();
const retentionTimer = setInterval(retention, 6 * 3_600_000);
retentionTimer.unref();

if (config.SCHEDULER_ENABLED) scheduler.start();
await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(
  {
    allowedHosts: config.ALLOWED_HOSTS,
    privateHosts: config.ALLOW_PRIVATE_HOSTS,
    webhook: Boolean(config.WEBHOOK_URL),
    metrics: Boolean(config.METRICS_TOKEN),
  },
  'signalpost started',
);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, 'shutting down');
  scheduler.stop();
  clearInterval(retentionTimer);
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
