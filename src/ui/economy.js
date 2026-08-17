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
    // [紧急需求] 岛屿禀赋:当前岛矿物 + 植物(玩家规划生产/铺矿场农场)
    const isl = (state.islands && state.activeIslandId) ? state.islands[state.activeIslandId] : null;
    if (isl) {
      const MINERAL_NAMES = { clay: '黏土', iron: '铁', coal: '煤', copper: '铜', zinc: '锌', limestone: '石灰岩', gold: '金' };
      const MINERAL_ICONS = { clay: '🏺', iron: '⛓️', coal: '⚫', copper: '🟠', zinc: '🔩', limestone: '🪨', gold: '🟡' };
      const FERT_NAMES = { potato: '土豆', grain: '谷物', hops: '啤酒花', pepper: '胡椒', grapes: '葡萄' };
      const FERT_ICONS = { potato: '🥔', grain: '🌾', hops: '🍺', pepper: '🌶️', grapes: '🍇' };
      const depTxt = (isl.deposits || []).map((d) => (MINERAL_ICONS[d] || '') + (MINERAL_NAMES[d] || d)).join(' ') || '无矿物';
      const ferTxt = (isl.fertilities || []).map((f) => (FERT_ICONS[f] || '') + (FERT_NAMES[f] || f)).join(' ') || '无植物';
      html += '<div class="ec-group"><div class="ec-group-title">🏝️ 岛屿禀赋 · ' + (isl.name || isl.id) + '</div>' +
        '<div class="ec-row">⛏️ 矿物 ' + depTxt + '</div>' +
        '<div class="ec-row">🌱 植物 ' + ferTxt + '</div></div>';
    }
    el.innerHTML = html;
  }

  // 🍽️ 需求 tab:需求满足度(各阶层每需求 bar + 需求 X.X/min)
  // [服务型需求] market/bar 等无商品定义,显示服务建筑中文名(从 buildings 数据反查)
  const SERVICE_NAME = {};
  const SERVICE_ICON = { market: '🏪', bar: '🍺', school: '🏫', church: '⛪', university: '🎓', theater: '🎭', bank: '🏦', powerplant: '⚡', club: '🎩' };
  (function () {
    const defs = (root.Engine.buildings && root.Engine.buildings.BUILDINGS) || {};
    for (const d of Object.values(defs)) {
      if (d.service && d.service.type) SERVICE_NAME[d.service.type] = d.name;
    }
  })();
  function needName(good) {
    const g = GOODS[good];
    if (g) return g.icon + ' ' + g.name;
    const svc = SERVICE_NAME[good];
    if (svc) return (SERVICE_ICON[good] || '🏛️') + ' ' + svc;
    return good;
  }
  function renderNeeds(el, state) {
    // [M-01] 需求缺口:当前有人的阶层中未满需求
    // [B-42] 每行加「需求 X.X/min」(理论需求=当前人口×rate×60;服务型需求不显示;无负号)
    // [B-46 fix] 0 人口也显示已解锁阶层的需求列表+收益徽章(开局引导;未解锁阶层仍隐藏)
    let needsHtml = '';
    const needRates = root.Engine.population.currentNeedRates(state);
    for (const [tid, tier] of Object.entries(TIERS)) {
      const pop = state.population[tid];
      const needs = Object.entries(tier.needs || {});
      if (!needs.length) continue;
      if (!state.unlocks[tid]) continue;
      needsHtml += '<div class="ec-tier">' + tier.name + '</div>';
      for (const [good, need] of needs) {
        const sat = (pop.needSats || {})[good] ?? 0;
        const pct = Math.round(sat * 100);
        const tierRates = needRates.byTier[tid] || {};
        const rateTxt2 = need.service || !need.rate ? '' : ' 需求 ' + (tierRates[good] || 0).toFixed(1) + '/min';
        // [B-46] 收益徽章:告知完成需求后的收益类型(不写具体数值,渐进披露)
        const perks = [];
        if (need.influx) perks.push('+人口');
        if (need.income) perks.push('+钱');
        if (need.happiness) perks.push('+幸福');
        const perkHtml = perks.length ? '<span class="ec-perk">' + perks.join(' ') + '</span>' : '';
        needsHtml += '<div class="ec-need"><span class="ec-need-name">' + needName(good) + '</span>' +
          '<span class="ec-need-bar"><span class="ec-need-fill' + (pct >= 100 ? ' full' : (pct < 50 ? ' low' : '')) + '" style="width:' + pct + '%"></span></span>' +
          '<span class="ec-need-pct">' + pct + '%</span>' +
          '<span class="ec-need-rate">' + rateTxt2 + '</span>' + perkHtml + '</div>';
      }
    }
    el.innerHTML = needsHtml || '<div class="ec-empty">暂无人口需求数据</div>';
  }

  // 👷 人口 tab:分行显示各阶层(人口/岗位/幸福度)+ 总人口趋势 + 总幸福度
  // [B-50] 需求更新:各阶级分行;显示当前人口与所需劳动力(岗位);各阶层幸福度;总幸福度
  function renderPop(el, state) {
    const rates = state.rates || {};
    // [M-01 fix] 箭头与 /min 数值统一用引擎 60 tick 平滑口径(smoothMin)
    const popRate = rates['__pop'] ? rates['__pop'].smoothMin : 0;
    const trend = popRate > 0.05 ? '↑' : (popRate < -0.05 ? '↓' : '→');
    const popTrendTxt = Math.abs(popRate) >= 0.05 ? ' ' + (popRate > 0 ? '+' : '') + popRate.toFixed(1) + '/min' : '';
    const totalPop = Object.values(state.population).reduce((s, p) => s + (p.count || 0), 0);
    let html = '<div class="ec-overview">👥 总人口 ' + Math.round(totalPop) + trend + popTrendTxt +
      '<br>😊 总幸福度 ' + state.happiness + '%</div>';
    const TIER_ORDER = ['farmers', 'workers', 'artisans', 'engineers', 'investors'];
    const wf = state._wf || {};
    for (const tid of TIER_ORDER) {
      const t = TIERS[tid];
      const pop = state.population[tid];
      if (!t || !pop) continue;
      let line = '';
      if (state.unlocks[tid]) {
        line += t.name + ' ' + Math.round(pop.count) + ' 人';
        const w = wf[tid];
        if (w && w.need > 0) line += ' · 岗位 ' + w.need + '/' + Math.floor(w.pop) + '(' + Math.round(w.eff * 100) + '%)';
        if (pop.happiness) line += ' · 😊 ' + Math.round(pop.happiness) + '%';
      } else {
        // 未解锁:显示解锁条件(与建造菜单口径一致:上一阶层人口阈值;999999=暂未开放)
        const idx = TIER_ORDER.indexOf(tid);
        const prev = idx > 0 ? TIER_ORDER[idx - 1] : null;
        const req = (prev && t.unlockAt < 999999) ? '需' + TIERS[prev].name + ' ' + t.unlockAt : '暂未开放';
        line += t.name + ' 0 人 🔒 ' + req;
      }
      html += '<div class="pop-row">' + line + '</div>';
    }
    el.innerHTML = html;
  }

  root.UI = root.UI || {};
  root.UI.economy = { renderRes, renderNeeds, renderPop };
})(typeof globalThis !== 'undefined' ? globalThis : this);
