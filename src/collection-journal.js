import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const INTERVAL_MS = 600000;
export const DEADLINE_MS = 900000;
export const RETRY_MS = [60000, 180000, 600000];
const WEEK = 7 * 86400000;

export class CollectionJournal {
  constructor(file) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cursors (source_id TEXT PRIMARY KEY, next_slot INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, kind TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL, next_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER, owner TEXT, finished_at INTEGER, observed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status,next_at);
      CREATE TABLE IF NOT EXISTS attempts (
        job_id TEXT NOT NULL, attempt INTEGER NOT NULL, source_id TEXT NOT NULL,
        finished_at INTEGER NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(job_id,attempt)
      );
    `);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  plan(sources, now) {
    return this.transaction(() => {
      const slot = Math.floor(now / INTERVAL_MS) * INTERVAL_MS;
      const insert = this.db.prepare('INSERT OR IGNORE INTO jobs(id,source_id,kind,scheduled_at,next_at) VALUES(?,?,?,?,?)');
      for (const source of sources) {
        if (!source.enabled) {
          this.db.prepare("UPDATE jobs SET status='cancelled' WHERE source_id=? AND status IN ('pending','retry')").run(source.id);
          this.db.prepare('INSERT INTO cursors VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET next_slot=excluded.next_slot').run(source.id, slot + INTERVAL_MS);
          continue;
        }
        let next = this.db.prepare('SELECT next_slot FROM cursors WHERE source_id=?').get(source.id)?.next_slot ?? slot;
        next = Math.max(next, slot - WEEK);
        for (; next <= slot; next += INTERVAL_MS) insert.run(`${source.id}:${next}`, source.id, 'scheduled', next, next);
        this.db.prepare('INSERT INTO cursors VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET next_slot=excluded.next_slot').run(source.id, next);
      }
      this.db.prepare("UPDATE jobs SET status='missed' WHERE kind='scheduled' AND scheduled_at+?<? AND (status IN ('pending','retry') OR (status='running' AND lease_until<?))").run(DEADLINE_MS, now, now);
      this.db.prepare('DELETE FROM attempts WHERE finished_at<?').run(now - WEEK - 86400000);
      this.db.prepare('DELETE FROM jobs WHERE scheduled_at<?').run(now - WEEK - 86400000);
    });
  }
  addManual(sources, now) {
    this.transaction(() => {
      for (const source of sources.filter(source => source.enabled)) {
        this.db.prepare('INSERT INTO jobs(id,source_id,kind,scheduled_at,next_at) VALUES(?,?,?,?,?)').run(
          `${source.id}:manual:${randomUUID()}`, source.id, 'manual', now, now
        );
      }
    });
  }
  claim(now, activeIds, { manualOnly = false } = {}) {
    return this.transaction(() => {
      this.db.prepare("UPDATE jobs SET status='failed' WHERE status='running' AND lease_until<=? AND attempts>=4").run(now);
      const candidates = this.db.prepare("SELECT * FROM jobs WHERE (status IN ('pending','retry') AND next_at<=?) OR (status='running' AND lease_until<=?) ORDER BY scheduled_at,id").all(now, now);
      const job = candidates.find(candidate => activeIds.includes(candidate.source_id) && (!manualOnly || candidate.kind === 'manual'));
      if (!job) return null;
      const owner = randomUUID();
      this.db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, owner=?, lease_until=? WHERE id=?").run(owner, now + 60000, job.id);
      return { ...job, owner, attempts: job.attempts + 1 };
    });
  }
  finish(job, result, now) {
    return this.transaction(() => {
      const current = this.db.prepare('SELECT owner,status FROM jobs WHERE id=?').get(job.id);
      if (!current || current.owner !== job.owner || current.status !== 'running') return false;
      const outcome = result.ok ? (result.quote.comparable ? 'usable' : 'needs_verification') : 'error';
      const delay = RETRY_MS[job.attempts - 1];
      const status = result.ok ? (outcome === 'usable' ? 'succeeded' : 'needs_verification') : (delay === undefined ? 'failed' : 'retry');
      this.db.prepare('INSERT OR REPLACE INTO attempts VALUES(?,?,?,?,?)').run(job.id, job.attempts, job.source_id, now, outcome);
      this.db.prepare('UPDATE jobs SET status=?,next_at=?,lease_until=NULL,owner=NULL,finished_at=?,observed_at=? WHERE id=?').run(
        status, delay === undefined ? now : now + delay, now,
        result.ok ? result.quote.observedAt : null, job.id
      );
      return true;
    });
  }
  status(now, sources) {
    const jobs = this.db.prepare("SELECT * FROM jobs WHERE kind='scheduled' AND scheduled_at>? AND status!='cancelled'").all(now - WEEK - DEADLINE_MS);
    const active = sources.filter(source => source.enabled);
    const mature = jobs.filter(job => active.some(source => source.id === job.source_id) && job.scheduled_at + DEADLINE_MS <= now);
    const timely = mature.filter(job => job.status === 'succeeded' && job.finished_at <= job.scheduled_at + DEADLINE_MS);
    return {
      intervalSeconds: INTERVAL_MS / 1000, deadlineSeconds: DEADLINE_MS / 1000,
      windowDays: 7, maturedJobs: mature.length, timelyUsableJobs: timely.length,
      timelySuccessRate: mature.length ? timely.length / mature.length : null,
      sevenDayAccepted: active.length > 0 && active.every(source => mature.filter(job => job.source_id === source.id).length >= 7 * 144) && timely.length / mature.length >= 0.95,
      sources: sources.map(source => {
        const last = this.db.prepare('SELECT * FROM attempts WHERE source_id=? ORDER BY finished_at DESC,job_id DESC,attempt DESC LIMIT 3').all(source.id);
        const latest = this.db.prepare("SELECT * FROM jobs WHERE source_id=? AND status IN ('succeeded','needs_verification') ORDER BY finished_at DESC LIMIT 1").get(source.id);
        return { id: source.id, consecutiveFailureAlert: last.length === 3 && last.every(attempt => attempt.result === 'error'),
          lastAttemptAt: last[0] ? new Date(last[0].finished_at).toISOString() : null,
          lastObservedAt: latest?.observed_at ?? null, lastResult: last[0]?.result ?? null };
      })
    };
  }
  close() { this.db.close(); }
}
