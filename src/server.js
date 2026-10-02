import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET } from './catalog.js';
import { calculateDeal } from './deals.js';
import { fetchVerifiedQuote } from './quotes.js';
import { loadSources } from './sources.js';
import { QuoteStore } from './store.js';
import { summarizeHistory } from './history.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const store = new QuoteStore(process.env.HISTORY_FILE || fileURLToPath(new URL('../data/history.json', import.meta.url)));
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };

export function createApp({ sources = loadSources(), quoteStore = store, fetchImpl = fetch } = {}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const history = await quoteStore.list();
        return json(res, 200, { target: TARGET, sources: sources.map(({ id, name, enabled }) => ({ id, name, enabled })), history, historySummary: summarizeHistory(history), hasObservedHistory: history.length > 0, hasVerifiedHistory: false });
      }
      if (req.method === 'POST' && url.pathname === '/api/calculate') return json(res, 200, calculateDeal(await readBody(req)));
      if (req.method === 'POST' && url.pathname === '/api/quotes/refresh') {
        const results = await Promise.all(sources.map(source => fetchVerifiedQuote(source, { fetchImpl })));
        await Promise.all(results.filter(result => result.ok).map(result => quoteStore.add(result.quote)));
        return json(res, 200, { results });
      }
      if (req.method !== 'GET') return json(res, 404, { error: 'Not found' });
      const requested = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '');
      const file = join(root, requested);
      if (!file.startsWith(root)) return json(res, 403, { error: 'Forbidden' });
      const content = await readFile(file);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(content);
    } catch (error) {
      if (error.code === 'ENOENT') return json(res, 404, { error: 'Not found' });
      json(res, error instanceof SyntaxError || error instanceof TypeError ? 400 : 500, { error: error.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Deal Radar: http://localhost:${port}`));
}
