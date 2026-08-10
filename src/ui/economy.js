/* economy.js — 左栏经济信息面板(可伸缩 + Tab 切换:资源/需求/人口)[UI改造 A2+B2] */
(function (root) {
  'use strict';
  const { GOODS, CATS } = root.Engine.goods;
  const { TIERS } = root.Engine.tiers;

  function rateCls(n) {
    if (n > 0.001) return 'rate-pos';
    if (n < -0.001) return 'rate-neg';
    return 'rate-zero';
  }
  function rateTxt(n) {
    if (n > 0.001) return '+' + n.toFixed(1);
    if (n < -0.001) return n.toFixed(1);
    return '0.0';
  }
  // [M-04] 预计耗尽时间(负增长且库存>0)
  function drainTxt(stock, rate) {
    if (rate < -0.001 && stock > 0) {
      const sec = stock / (-rate / 60);
      if (sec < 600) return ' ⏳' + Math.ceil(sec) + 's';
    }
    return '';
  }

  // [M-01] 人口趋势统一用引擎 smoothMin(↑/↓/→ 与 /min 数值同口径),无 UI 侧状态

  function rowHtml(icon, name, stock, rate, extra) {
    return '<div class="inv-row"><span class="inv-icon">' + icon + '</span><span class="inv-name">' + name + '</span>' +
      '<span class="inv-stock">' + Math.floor(stock || 0) + '</span>' +
      '<span class="' + rateCls(rate) + '">' + rateTxt(rate) + '/min</span>' + (extra || '') + '</div>';
  }

  function groupHtml(cat, ids, state, rates, open) {
    let rows = '';
    for (const id of ids) {
      const g = GOODS[id];
      if (!g) continue;
      const r = rates[id] || { net: 0 };
      const rate = r.smoothMin != null ? r.smoothMin : r.net * 60;
      rows += rowHtml(g.icon, g.name, state.resources[id] || 0, rate, drainTxt(state.resources[id] || 0, rate));
    }
    if (!rows) return '';
    return '<details' + (open ? ' open' : '') + '><summary class="ec-group-title">' + cat.name + '</summary>' + rows + '</details>';
  }

  // [UI改造 A2+B2] render 拆分为三个区块渲染(左侧 Tab:资源/需求/人口),
  // 内部逻辑与 [H-02]/[M-01]/[B-42] 行为完全一致,仅输出容器分离。

  // 📊 资源 tab:关注(金币含收支分解)+ 可折叠分组库存
  function renderRes(el, state) {
    const rates = state.rates || {};
    // [H-02] 关注资源:核心三件套 + 自动加入负增长/即将耗尽
    const watched = [];
    const pushWatch = (id, icon, name) => {
      const r = rates[id] || { net: 0 };
      const rate = r.smoothMin != null ? r.smoothMin : r.net * 60;
      watched.push({ id, icon, name, stock: state.resources[id] || 0, rate });
    };
    pushWatch('coin', '💰', '金币');
    pushWatch('wood', '🪵', '木材');
    pushWatch('fish', '🐟', '鱼');
    for (const [id, g] of Object.entries(GOODS)) {
      if (watched.some((w) => w.id === id)) continue;
      const r = rates[id] || { net: 0 };
      const rate = r.smoothMin != null ? r.smoothMin : r.net * 60;
      const stock = state.resources[id] || 0;
      if (rate < -0.05 || (rate < 0 && stock > 0 && stock / (-rate / 60) < 120)) {
        watched.push({ id, icon: g.icon, name: g.name, stock, rate });
      }
    }
    const watchHtml = '<div class="ec-group"><div class="ec-group-title">⭐ 关注</div>' +
      watched.map((w) => {
        // [B-42] 金币行:收入=60tick平滑收入;维护=即时总维护;净=收入-维护(主行与分解严格同源)
        let extra = '';
        if (w.id === 'coin') {
          const r = rates.coin || {};
          const inc = r.smoothProducedMin != null ? r.smoothProducedMin : 0;
          const mnt = root.Engine.economy.totalMaintenancePerMin(state);
          const net = inc - mnt;
          extra = '<span class="ec-coin-break">收入 ' + rateTxt(inc) + ' 维护 ' + rateTxt(-mnt) + '</span>';
          w.rate = net; // 主行 /min = 净变化(与分解同源,不再用旧 smoothMin)
        }
        return rowHtml(w.icon, w.name, w.stock, w.rate, drainTxt(w.stock, w.rate) + extra);
      }).join('') + '</div>';

    // 分组折叠:货币不重复(金币已在关注)
    // [H-02 fix] 需求组只含"已解锁阶层"的需求商品(渐进披露);未解锁的并入其他组
    // [H-02 fix] 折叠状态保留:渲染前读取现有 details open 状态,重建后恢复
    const catOf = {};
    for (const id of Object.keys(GOODS)) (catOf[GOODS[id].cat] = catOf[GOODS[id].cat] || []).push(id);
    const unlockedTiers = new Set(Object.keys(TIERS).filter((tid) => state.unlocks[tid]));
    const tierGoods = new Set();
    for (const tid of Object.keys(TIERS)) {
      if (!unlockedTiers.has(tid)) continue;
      for (const g of Object.keys((TIERS[tid].needs || {}))) tierGoods.add(g);
    }
    const matIds = catOf['material'] || [];
    const needsIds = (catOf['basic'] || []).concat(catOf['luxury'] || []).filter((id) => tierGoods.has(id));
    const rawIds = catOf['raw'] || [];
    const otherIds = [];
    for (const id of Object.keys(GOODS)) {
      if (!matIds.includes(id) && !needsIds.includes(id) && !rawIds.includes(id)) otherIds.push(id);
    }
    // 折叠状态:key = 组名;默认建材开、其余关(默认内容 ≤ 一屏)
    const prevOpen = {};
    el.querySelectorAll('details').forEach((d) => {
      const s = d.querySelector('summary');
      if (s) prevOpen[s.textContent] = d.open;
    });
    const grp = (key, name, ids, defOpen) => {
      // [H-02 fix] prevOpen 以 summary 文本为键,必须用 name 查询(原代码查 key 导致永远走默认值)
      const open = name in prevOpen ? prevOpen[name] : defOpen;
      return groupHtml({ name }, ids, state, rates, open);
    };
    let html = watchHtml;
    html += grp('mat', '🧱 建材', matIds, true);
    html += grp('needs', '🍞 需求(已解锁)', needsIds, false);
    html += grp('raw', '🌾 原料', rawIds, false);
    html += grp('other', '📦 其他(未解锁/远期货)', otherIds, false);
    el.innerHTML = html;
  }

  // 🍽️ 需求 tab:需求满足度(各阶层每需求 bar + 需求 X.X/min)
  function renderNeeds(el, state) {
    // [M-01] 需求缺口:当前有人的阶层中未满需求
    // [B-42] 每行加「需求 X.X/min」(理论需求=当前人口×rate×60;服务型需求不显示;无负号)
    let needsHtml = '';
    const needRates = root.Engine.population.currentNeedRates(state);
    for (const [tid, tier] of Object.entries(TIERS)) {
      const pop = state.population[tid];
      const needs = Object.entries(tier.needs || {});
      if (!needs.length || pop.count <= 0) continue;
      needsHtml += '<div class="ec-tier">' + tier.name + '</div>';
      for (const [good, need] of needs) {
        const g = GOODS[good];
        const sat = (pop.needSats || {})[good] ?? 0;
        const pct = Math.round(sat * 100);
        const tierRates = needRates.byTier[tid] || {};
        const rateTxt2 = need.service || !need.rate ? '' : ' 需求 ' + (tierRates[good] || 0).toFixed(1) + '/min';
        needsHtml += '<div class="ec-need"><span class="ec-need-name">' + (g ? g.icon + ' ' + g.name : good) + '</span>' +
          '<span class="ec-need-bar"><span class="ec-need-fill' + (pct >= 100 ? ' full' : (pct < 50 ? ' low' : '')) + "' style='width:" + pct + "%'></span></span>" +
          '<span class="ec-need-pct">' + pct + '%</span>' +
          '<span class="ec-need-rate">' + rateTxt2 + '</span></div>';
      }
    }
    el.innerHTML = needsHtml || '<div class="ec-empty">暂无人口需求数据</div>';
  }

  // 👷 人口 tab:人口总览(各阶层数量/趋势/幸福度)
  function renderPop(el, state) {
    const rates = state.rates || {};
    // [M-01 fix] 箭头与 /min 数值统一用引擎 60 tick 平滑口径(smoothMin),
    // 不再用"本次 render 与上次 render 的差值"(额外 redraw 会把箭头误置为 →)
    const popRate = rates['__pop'] ? rates['__pop'].smoothMin : 0;
    const trend = popRate > 0.05 ? '↑' : (popRate < -0.05 ? '↓' : '→');
    const popTrendTxt = Math.abs(popRate) >= 0.05 ? ' ' + (popRate > 0 ? '+' : '') + popRate.toFixed(1) + '/min' : '';
    let popParts = [];
    for (const id of Object.keys(TIERS)) {
      popParts.push(TIERS[id].name + ' ' + Math.round(state.population[id].count) + (state.unlocks[id] ? '' : '🔒'));
    }
    const overview = '<div class="ec-overview">👥 ' + popParts.join(' ') + trend + popTrendTxt +
      '<br>😊 幸福度 ' + state.happiness + '%</div>';
    el.innerHTML = overview;
  }

  root.UI = root.UI || {};
  root.UI.economy = { renderRes, renderNeeds, renderPop };
})(typeof globalThis !== 'undefined' ? globalThis : this);
