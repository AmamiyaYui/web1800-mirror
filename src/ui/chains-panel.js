/* chains-panel.js — 生产链总览面板(生产者 → 商品 → 消费者) [V1.2]
 * [V1.10 修订⑤ 顺序16] 机制速览已独立到 guide.js(顶部「📖 机制速览」按钮) */
(function (root) {
  'use strict';

  function render(el, chains) {
    const goodsNames = root.Engine.goods.GOODS;
    const rows = Object.keys(chains).map((g) => {
      const c = chains[g];
      const name = goodsNames[g] ? goodsNames[g].name : g;
      const prod = c.producers.map((d) => d.name).join('、') || '—';
      const cons = c.consumers.map((d) => d.name).join('、') || '—';
      return '<div class="chain-row">' +
        '<span class="chain-prod">' + prod + '</span>' +
        '<span class="chain-arrow">→ ' + name + ' →</span>' +
        '<span class="chain-cons">' + cons + '</span></div>';
    }).join('');
    el.innerHTML =
      '<div class="guide-title">🔗 生产链总览</div>' +
      (rows || '<div style="opacity:.6">暂无生产链</div>');
  }

  root.UI = root.UI || {};
  root.UI.chainsPanel = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
