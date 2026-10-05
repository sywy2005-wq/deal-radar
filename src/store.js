import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { comparisonKey } from './conditions.js';
import { moneyCents } from './money.js';

export class QuoteStore {
  constructor(file, { io = {} } = {}) {
    this.file = file;
    this.queue = Promise.resolve();
    this.io = { mkdir, readFile, rename, writeFile, unlink, ...io };
    this.sequence = 0;
  }
  async list() {
    try {
      const rows = JSON.parse(await this.io.readFile(this.file, 'utf8'));
      if (!Array.isArray(rows)) throw new TypeError('历史文件必须是数组');
      return rows;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  async add(quote) {
    if (!quote || typeof quote.verifiedAt !== 'string' || !Number.isFinite(Date.parse(quote.verifiedAt))) throw new TypeError('只允许保存已校验报价');
    if (!quote.sourceId || quote.sku !== 'KX0493' || quote.size !== 'L' || quote.currency !== 'CNY' || !Number.isFinite(Date.parse(quote.observedAt)) || moneyCents(quote.price, '价格') <= 0) throw new TypeError('报价身份或价格无效');
    const operation = this.queue.then(async () => {
      const rows = await this.list();
      const rowKey = row => JSON.stringify([
        comparisonKey(row), row.observedAt, row.stock, row.shippingCents,
        row.priceCents ?? moneyCents(row.price), row.priceValidUntil,
        row.evidence?.responseSha256, row.evidence?.parserVersion,
        row.pricing?.status, row.pricing?.validUntil,
        row.pricing?.applied?.map(offer => offer.id)
      ]);
      const key = rowKey(quote);
      if (rows.some(row => rowKey(row) === key)) return quote;
      rows.push(quote);
      await this.io.mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.${this.sequence++}.tmp`;
      try {
        await this.io.writeFile(temporary, `${JSON.stringify(rows, null, 2)}\n`);
        await this.io.rename(temporary, this.file);
      } catch (error) {
        try { await this.io.unlink(temporary); } catch {}
        throw error;
      }
      return quote;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
