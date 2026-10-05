import { fetchVerifiedQuote } from './quotes.js';

export class Collector {
  constructor({ sources, quoteStore, journal, fetchImpl = fetch, clock = () => Date.now(), enabled = false }) {
    this.sources = sources; this.quoteStore = quoteStore; this.journal = journal;
    this.fetchImpl = fetchImpl; this.clock = clock; this.enabled = enabled;
    this.inFlight = null; this.timer = null; this.startedAt = null;
  }
  run({ manual = false } = {}) {
    if (this.inFlight) return this.inFlight;
    const operation = this.collect(manual);
    this.inFlight = operation.finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async collect(manual) {
    if (this.enabled) this.journal.plan(this.sources, this.clock());
    if (manual) this.journal.addManual(this.sources, this.clock());
    const results = [];
    const active = this.sources.filter(source => source.enabled);
    for (let count = 0; count < 20; count++) {
      const job = this.journal.claim(this.clock(), active.map(source => source.id), { manualOnly: !this.enabled });
      if (!job) break;
      const source = active.find(source => source.id === job.source_id);
      let result = await fetchVerifiedQuote(source, { fetchImpl: this.fetchImpl });
      if (result.ok) {
        try { await this.quoteStore.add(result.quote); }
        catch { result = { ok: false, status: 'error', errors: ['报价持久化失败'] }; }
      }
      this.journal.finish(job, result, this.clock());
      results.push({ ...result, sourceId: source.id, attempt: job.attempts });
    }
    return { results };
  }
  status() {
    return { enabled: this.enabled, running: Boolean(this.timer), startedAt: this.startedAt,
      ...this.journal.status(this.clock(), this.sources) };
  }
  start() {
    if (!this.enabled || this.timer) return;
    this.startedAt = new Date(this.clock()).toISOString();
    const tick = () => this.run().catch(() => console.error('collection_tick_failed'));
    this.timer = setInterval(tick, 15000);
    this.timer.unref?.();
    tick();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight) await this.inFlight.catch(() => {});
  }
}
