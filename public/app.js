const $ = selector => document.querySelector(selector);
const yuan = value => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function renderHistory(rows) {
  $('#history-count').textContent = `${rows.length} 条`;
  if (!rows.length) return;
  $('#history').className = 'quote-list';
  $('#history').innerHTML = rows.slice().reverse().map(row => `<article><div><strong>${row.sourceName}</strong><small>${new Date(row.observedAt).toLocaleString('zh-CN')}</small></div><b>${yuan(row.price)}</b><a href="${row.productUrl}" target="_blank" rel="noopener">查看来源 ↗</a></article>`).join('');
  const minimum = Math.min(...rows.map(row => row.price));
  $('#notice').innerHTML = `<strong>已验证历史最低 ${yuan(minimum)}</strong><span>仅基于下方 ${rows.length} 条真实校验记录，不代表全网最低。</span>`;
  $('#notice').classList.add('verified');
}

async function load() { const status = await request('/api/status'); renderHistory(status.history); }

$('#refresh').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; button.textContent = '校验中…';
  try {
    const { results } = await request('/api/quotes/refresh', { method: 'POST' });
    const valid = results.filter(item => item.ok);
    $('#quotes').textContent = results.length ? (valid.length ? `已取得 ${valid.length} 条有效报价。` : results.flatMap(item => item.errors).join('；')) : '没有配置数据源。请按 README 接入后显式启用。';
    await load();
  } catch (error) { $('#quotes').textContent = error.message; }
  finally { button.disabled = false; button.textContent = '立即校验'; }
});

$('#calculate').addEventListener('click', async () => {
  try {
    const result = await request('/api/calculate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ price: $('#price').value, offers: [{ type: 'percent', value: $('#percent').value, label: '折扣' }, { type: 'fixed', value: $('#fixed').value, label: '立减' }] }) });
    $('#result strong').textContent = yuan(result.payable);
    $('#result small').textContent = `共省 ${yuan(result.saved)} · 仅计算，不作为真实报价`;
  } catch (error) { $('#result strong').textContent = '输入有误'; $('#result small').textContent = error.message; }
});

load().catch(error => { $('#notice span').textContent = `状态读取失败：${error.message}`; });
