const $ = selector => document.querySelector(selector);
const yuan = value => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
const when = value => new Date(value).toLocaleString('zh-CN');

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function renderHistory(rows, summary) {
  $('#history-count').textContent = `${rows.length} 条`;
  const history = $('#history');
  history.replaceChildren();
  $('#notice').classList.remove('verified');
  if (!rows.length) {
    history.className = 'empty';
    history.textContent = '暂无真实历史数据，因此不提供历史价格结论。';
    $('#notice strong').textContent = '尚无真实报价';
    $('#notice span').textContent = '未经验证的数据源默认关闭；页面不会展示或推断价格。';
    return;
  }
  history.className = 'quote-list';
  for (const group of summary.groups) {
    const article = element('article', '');
    const detail = element('div', '');
    detail.append(
      element('strong', `已采集记录中的最低价 ${yuan(group.minimumCents / 100)}`),
      element('small', `${group.sourceName} · ${group.color} · ${group.shippingRegion} · ${group.eligibilityKey} · 数量 ${group.quantity}`),
      element('small', `${when(group.observedFrom)} 至 ${when(group.observedTo)} · ${group.count} 条记录 · 按来源条件合计，未经过结账核验`)
    );
    article.append(detail);
    history.append(article);
  }
  for (const row of rows.slice().reverse()) {
    const article = element('article', '');
    const detail = element('div', '');
    detail.append(element('strong', row.sourceName), element('small', when(row.observedAt)));
    detail.append(element('small', row.comparable
      ? `${row.color} · ${row.shippingRegion} · ${row.eligibilityKey} · 运费 ${yuan(row.shippingCents / 100)}`
      : `待核验：${(row.needsVerification || ['历史记录缺少购买条件']).join('；')}`));
    article.append(detail, element('b', `来源商品价 ${yuan(row.price)}`));
    try {
      const url = new URL(row.productUrl);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
        const link = element('a', '查看来源 ↗');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        article.append(link);
      }
    } catch {}
    history.append(article);
  }
  $('#notice strong').textContent = `已采集 ${rows.length} 条报价记录`;
  $('#notice span').textContent = `${summary.pendingCount} 条购买条件待核验；最低值仅覆盖已采集区间，并按来源、颜色和购买条件分组。`;
}
async function load() {
  const status = await request('/api/status');
  renderHistory(status.history, status.historySummary);
}
$('#refresh').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = '校验中…';
  try {
    const { results } = await request('/api/quotes/refresh', { method: 'POST' });
    const accepted = results.filter(item => item.ok);
    $('#quotes').textContent = results.length
      ? (accepted.length ? `已取得 ${accepted.length} 条字段校验通过的记录；购买条件请查看下方待核验提示。` : results.flatMap(item => item.errors).join('；'))
      : '没有配置数据源。请按 README 接入后显式启用。';
    await load();
  } catch (error) { $('#quotes').textContent = error.message; }
  finally { button.disabled = false; button.textContent = '立即校验'; }
});
$('#calculate').addEventListener('click', async () => {
  try {
    const result = await request('/api/calculate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ price: $('#price').value, offers: [
        { type: 'percent', value: $('#percent').value, label: '折扣' },
        { type: 'fixed', value: $('#fixed').value, label: '立减' }
      ] })
    });
    $('#result strong').textContent = yuan(result.payable);
    $('#result small').textContent = `共省 ${yuan(result.saved)} · 仅计算商品金额，不含未输入的运费，也不作为真实报价`;
  } catch (error) {
    $('#result strong').textContent = '输入有误';
    $('#result small').textContent = error.message;
  }
});
load().catch(error => { $('#notice span').textContent = `状态读取失败：${error.message}`; });
