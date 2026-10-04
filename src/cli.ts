import { loadConfig } from './config.js';
import { backupTo, restoreFrom } from './db/backup.js';
import { migrate, openDb } from './db/db.js';
import { resetDemo, seed } from './db/seed.js';
import { createDemoTarget } from './demo/target.js';
import { runRetention } from './monitor/retention.js';

const [command, ...args] = process.argv.slice(2);
const config = loadConfig();

async function main(): Promise<number> {
  switch (command) {
    case 'migrate': {
      const db = openDb(config.DATABASE_PATH);
      console.log(`applied: ${migrate(db).join(', ') || 'nothing (up to date)'}`);
      db.close();
      return 0;
    }
    case 'seed': {
      const db = openDb(config.DATABASE_PATH);
      migrate(db);
      console.log(JSON.stringify(await seed(db, config)));
      db.close();
      return 0;
    }
    case 'reset-demo': {
      if (!args.includes('--yes')) {
        console.error(
          'reset-demo deletes all monitors, checks, incidents and the audit log, then seeds again. Add --yes.',
        );
        return 2;
      }
      const db = openDb(config.DATABASE_PATH);
      migrate(db);
      await resetDemo(db, config);
      console.log('demo data reset');
      db.close();
      return 0;
    }
    case 'backup': {
      const db = openDb(config.DATABASE_PATH);
      const r = await backupTo(db, config.BACKUP_DIR);
      console.log(`backup written: ${r.file} (${Math.round(r.bytes / 1024)} KB)`);
      db.close();
      return 0;
    }
    case 'restore': {
      const file = args[0];
      if (!file || !args.includes('--yes')) {
        console.error(
          'usage: restore <backup-file> --yes   (stop the server first; the current file is kept as .before-restore)',
        );
        return 2;
      }
      const r = restoreFrom(file, config.DATABASE_PATH);
      console.log(`restored ${file}${r.previous ? `; previous database kept at ${r.previous}` : ''}`);
      return 0;
    }
    case 'revoke-sessions': {
      const db = openDb(config.DATABASE_PATH);
      const n = db.prepare('DELETE FROM sessions').run().changes;
      db.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(
        Date.now(),
        'cli',
        'session.revoke_all',
        `${n} sessions revoked`,
      );
      console.log(`${n} sessions revoked; everyone must sign in again`);
      db.close();
      return 0;
    }
    case 'retention': {
      const db = openDb(config.DATABASE_PATH);
      console.log(JSON.stringify(runRetention(db, config.RETENTION_DAYS, config.APP_TIMEZONE)));
      db.close();
      return 0;
    }
    case 'healthcheck': {
      // Used by the container HEALTHCHECK: distroless images have no curl or wget.
      try {
        const res = await fetch(`http://127.0.0.1:${config.PORT}/readyz`, {
          signal: AbortSignal.timeout(3000),
        });
        return res.ok ? 0 : 1;
      } catch {
        return 1;
      }
    }
    case 'demo-target': {
      const server = createDemoTarget({
        controlToken: config.DEMO_CONTROL_TOKEN,
        webhookSecret: config.WEBHOOK_SECRET,
        log: (m) => console.log(m),
      });
      server.listen(8080, '0.0.0.0', () => console.log('demo target listening on 8080'));
      const stop = () => server.close(() => process.exit(0));
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
      return new Promise(() => {});
    }
    case 'demo-mode': {
      const mode = args[0] ?? '';
      if (!config.DEMO_CONTROL_TOKEN) {
        console.error('DEMO_CONTROL_TOKEN is not set');
        return 2;
      }
      const res = await fetch('http://127.0.0.1:8080/__mode', {
        method: 'POST',
        headers: { 'x-demo-token': config.DEMO_CONTROL_TOKEN },
        body: mode,
      });
      console.log((await res.text()).trim());
      return res.ok ? 0 : 1;
    }
    default:
      console.error(
        'commands: migrate | seed | reset-demo --yes | backup | restore <file> --yes | revoke-sessions | retention | healthcheck | demo-target | demo-mode <normal|slow|error>',
      );
      return 2;
  }
}

process.exitCode = await main();
