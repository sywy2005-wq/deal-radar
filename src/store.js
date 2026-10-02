import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class QuoteStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async list() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async add(quote) {
    if (!quote?.verifiedAt) throw new TypeError('只允许保存已校验报价');
    this.queue = this.queue.then(async () => {
      const rows = await this.list();
      const key = `${quote.sourceId}:${quote.sku}:${quote.size}:${quote.observedAt}`;
      if (!rows.some(row => `${row.sourceId}:${row.sku}:${row.size}:${row.observedAt}` === key)) rows.push(quote);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(rows, null, 2)}\n`);
      await rename(temporary, this.file);
      return quote;
    });
    return this.queue;
  }
}
