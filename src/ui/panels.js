/* panels.js — 建筑信息 / 地形信息 / 事件日志 / toast */
(function (root) {
  'use strict';

  // [岗位制 S1] 阶层中文名(岗位行/信息卡共用)
  const TIER_CN = { farmers: '农民', workers: '工人', artisans: '工匠', engineers: '工程师', investors: '投资人' };

  // [B-45] 建造信息卡:造价/材料/维护/周期/输入/输出/劳动力/占地(放置模式与已建建筑共用;纯定义信息,无状态行)
  // [用户确认] eff 参数:已建建筑按当前效率显示实际产出(效率<100% 时标注满速);放置模式不传=满速
  // [B-52] 速率格式化:保留 1 位小数去尾零(4→"4",0.67→"0.7"),避免 Math.round 把长周期建筑 0.5~1.4/min 误导为 1/min
  function fmtRate(v) {
    const r = Math.round(v * 10) / 10;
    return String(r);
  }
  function infoCardHtml(def, eff) {
    const goods = Engine.goods.name;
    let h = '';
    const costEntries = Object.entries(def.cost || {});
    if (costEntries.length) {
      const coin = costEntries.filter(([g]) => g === 'coin').map(([, q]) => '💰' + q);
      const mats = costEntries.filter(([g]) => g !== 'coin').map(([g, q]) => goods(g) + '×' + q);
      h += '<div>💰 造价:' + [coin.join(' '), mats.join(' ')].filter(Boolean).join(' ') + '</div>';
    }
    if (def.maintenance) h += '<div>⚙️ 维护:💰' + def.maintenance + '/min</div>';
    const p = def.production;
    if (p) {
      if (p.cycle) h += '<div>🔄 周期:' + p.cycle + ' 秒</div>';
      const applyEff = eff != null && eff < 0.999;
      const fmtQ = (q) => (Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100));
      const rateTxt = (q) => (p.cycle ? ' (' + fmtRate(q / p.cycle * 60) + '/min)' : '');
      const inT = Object.entries(p.inputs || {}).map(([g, q]) => goods(g) + '×' + fmtQ(q) + '/周期' + rateTxt(q)).join(', ') || '无';
      const outT = Object.entries(p.outputs || {}).map(([g, q]) => {
        const qty = applyEff ? q * eff : q;
        let s = goods(g) + '×' + fmtQ(qty) + '/周期' + rateTxt(qty);
        if (applyEff) s += ' · 满速' + rateTxt(q).replace(/[()]/g, '');
        return s;
      }).join(', ') || '无';
      h += '<div>⬇ 输入:' + inT + '</div><div>⬆ 输出:' + outT + '</div>';
      const wf = Object.entries(p.workforce || {}).map(([t, q]) => (TIER_CN[t] || t) + '×' + q).join(', ');
      if (wf) h += '<div>👷 劳动力:' + wf + '</div>';
    }
    if (def.service) h += '<div>📡 服务半径:' + def.service.radius + '</div>';
    if (def.capacity) h += '<div>🏠 容量:' + def.capacity + ' 人</div>';
    if (def.size) h += '<div>📐 占地:' + def.size.w + '×' + def.size.h + '</div>';
    if (p && p.radius) h += '<div>📍 开发半径:' + p.radius + '</div>';
    return h;
  }

  // [B-45] 放置模式信息卡(未建造,仅定义信息;由 main.js 在放置/移动模式时调用)
  function showPlacementInfo(el, def) {
    if (!def) { el.innerHTML = '<div class="panel-title">信息</div><div>点击建筑查看详情</div>'; return; }
    el.innerHTML = '<div class="panel-title">🛠 ' + def.name + '</div>' +
      '<div>🖱 点击地图放置 · R 旋转 · Esc 取消</div>' + infoCardHtml(def);
  }

  // [V1.10 修订⑤ 顺序14] 住宅升级入口:上一级住宅 → 下一级(条件=全部基础需求+建材,引擎判定)
  // [V1.10 修订⑤ 顺序23] 移动建筑入口(onMove 回调)
  function showBuilding(el, state, buildingId, onUpgrade, onMove) {
    if (!buildingId) {
      el.innerHTML = '<div class="panel-title">信息</div><div>点击建筑查看详情</div>';
      return;
    }
    const b = state.buildings[buildingId];
    if (!b) { el.innerHTML = '<div class="panel-title">信息</div><div>(已拆除)</div>'; return; }
    const def = Engine.buildings.getDef(b.type);
    function statusTextFor(st) {
      return { producing: '✅ 生产中', waiting: '⏳ 等待中', disconnected: '⚠️ 未连通仓库', idle: '⏸ 闲置' }[st] || st;
    }
    // [H-03] 停工原因中文化 + 数值细节 + 下一步建议
    const REASON_TEXT = {
      'road-disconnected': { t: '⚠️ 道路断开,未连通仓库', tip: '铺路连接到任意仓库' },
      'no-road': { t: '⚠️ 民居未接触道路', tip: '在民居旁铺路(无需连接仓库)' },
      'workforce-shortage': { t: '⏳ 劳动力不足', tip: '建造住宅并满足其需求以增加人口' },
      'input-shortage': { t: '⏳ 缺少原料', tip: '补齐对应原料生产链,或检查上游是否停产' },
      'warehouse-out-of-range': { t: '⏳ 超出仓库服务范围', tip: '把建筑移到仓库服务范围内,或新建仓库' },
      'development-too-low': { t: '⏳ 开发度过高', tip: '把农田/牧场移到开阔平地(可开发度高)' },
      producing: { t: '✅ 生产中', tip: '' },
      idle: { t: '⏸ 闲置', tip: '' },
    };
    const rInfo = REASON_TEXT[b.reason] || { t: statusTextFor(b.status), tip: '' };
    let statusLine = '状态:' + rInfo.t;
    const d = b.detail;
    if (d) {
      if (b.reason === 'workforce-shortage') {
        const tierName = { farmers: '农民', workers: '工人', artisans: '工匠', engineers: '工程师', investors: '投资人' }[d.tier] || d.tier;
        statusLine += '(需要 ' + tierName + ' ' + d.need + ' / 当前 ' + Math.floor(d.have) + ')';
      } else if (b.reason === 'input-shortage') {
        const gName = Engine.goods && Engine.goods.name ? Engine.goods.name(d.good) : d.good;
        statusLine += '(需要 ' + gName + ' ×' + d.need + ' / 当前 ' + Math.floor(d.have || 0) + ')';
      } else if (b.reason === 'development-too-low') {
        statusLine += '(可开发 ' + Math.round((1 - (d.dev || 0)) * 100) + '%)';
      }
    }
    let html = '<div class="panel-title">' + def.name + '</div>';
    html += '<div>' + statusLine + '</div>';
    if (rInfo.tip) html += '<div class="tip-line">💡 ' + rInfo.tip + '</div>';
    html += '<div>位置:(' + b.x + ',' + b.y + ')</div>';
    // [B-63] 造船厂订单区:队列(等待/建造中)+ 下单/取消(REQ-39/AC-21)
    if (b.type === 'sailingShipyard' && root.Engine.ships && root.Engine.shipsData) {
      const ships = root.Engine.ships;
      const orders = ships.ordersOf(state, state.activeIslandId, b.id);
      const limit = root.Engine.shipsData.SHIPYARD_ORDER_LIMIT;
      const type = root.Engine.shipsData.SHIP_TYPES[Object.keys(root.Engine.shipsData.SHIP_TYPES)[0]];
      let orderHtml = '';
      for (const o of orders) {
        const pct = o.totalWork > 0 ? Math.round((o.totalWork - o.remainingWork) / o.totalWork * 100) : 0;
        const tag = pct === 0 ? '⏳ 等待' : '🔨 建造中 ' + pct + '%';
        orderHtml += '<div class="order-row"><span>' + tag + ' · ' + (type ? type.name : o.shipType) + '</span>' +
          '<button class="mini-btn" data-cancel-order="' + o.id + '">取消</button></div>';
      }
      html += '<div class="order-sec">🚢 造船订单 (' + orders.length + '/' + limit + ')' +
        (orderHtml || '<div class="order-empty">无订单</div>') + '</div>';
      if (orders.length < limit) {
        html += '<button class="mini-btn" id="btn-ship-order" data-shipyard="' + b.id + '">🛠️ 下单(' +
          (type ? type.cost.coin + '金+' + type.cost.wood + '木+' + type.cost.sail + '帆 · ' + Math.round(type.workTicks / 60) + '分钟' : '') +
          ')</button>';
      }
    }
    // [岗位制 S1] 岗位行 + 综合效率(开发度 × 岗位):先算再传信息卡(实际产出)
    let effDev = null, effWf = null;
    if (def.production && def.production.workforce) {
      const wfParts = [];
      for (const [tier, need] of Object.entries(def.production.workforce)) {
        const w = (state._wf || {})[tier];
        if (w) {
          wfParts.push((TIER_CN[tier] || tier) + ' 岗位 ' + w.need + '/' + Math.floor(w.pop) + '(' + Math.round(w.eff * 100) + '%)');
          effWf = effWf == null ? w.eff : Math.min(effWf, w.eff);
        }
      }
      if (wfParts.length) html += '<div>⚙️ ' + wfParts.join(' ') + '</div>';
    }
    if (def.production && def.production.radius) {
      // [用户要求] 农田/牧场/伐木类:可开发度 + 综合生产效率(开发度=未占用地块占比)
      let dev = 0;
      try { dev = Engine.economy.developmentRatio(state, b, def); } catch (e) { /* 忽略 */ }
      effDev = Engine.economy.efficiencyFor(dev);
      const open = Math.round((1 - dev) * 100);
      const effTotal = effDev * (effWf == null ? 1 : effWf);
      let effLine = '当前效率:' + Math.round(effDev * 100) + '%(开发度)';
      if (effWf != null) effLine += '×' + Math.round(effWf * 100) + '%(岗位)';
      effLine += '≈' + Math.round(effTotal * 100) + '%';
      html += '<div>可开发:' + open + '%</div><div>' + effLine + '</div>';
    } else if (effWf != null && effWf < 0.999) {
      // 普通生产建筑:仅岗位效率
      html += '<div>当前效率:' + Math.round(effWf * 100) + '%(岗位)</div>';
    }
    const effTotal = (effDev == null ? 1 : effDev) * (effWf == null ? 1 : effWf);
    html += infoCardHtml(def, effTotal < 0.999 ? effTotal : null);
    if (def.capacity) {
      // [玩家反馈 #4] 住户显示 当前人数/容量(引擎 refreshOccupancy 分配单栋住户)
      const occ = Math.round(b.occupied || 0);
      html += '<div>住户:' + occ + '/' + def.capacity + ' 人</div>';
    }
    // [V1.10 修订⑤ 顺序14] 住宅升级入口(条件=全部基础需求+建材,引擎判定)
    // [M-02] 逐项 ✅/❌ 清单,条件未满足禁用按钮(不再点击后才报错)
    if (def.upgrade) {
      const up = Engine.buildings.getDef(def.upgrade.to);
      const costTxt = Object.entries(def.upgrade.cost || {}).map(([g, q]) => Engine.goods.name(g) + '×' + q).join(' ');
      let fullOk = false, basicOk = false, matOk = false;
      try {
        Engine.population.refreshOccupancy(state);
        // [B-43 返工 A] UI 满员判定用真实 occupied(9.5/10 不可升级;round 只用于显示)
        const occ = b.occupied || 0;
        fullOk = occ >= (def.capacity || 1) - 0.001;
        const pop = state.population[def.tier];
        const needSats = (pop && pop.needSats) || {};
        const tierDef = Engine.tiers.TIERS[def.tier];
        basicOk = tierDef ? Object.entries(tierDef.needs || {}).filter(([, n]) => n.influx).every(([g]) => (needSats[g] ?? 0) >= 0.999) : true;
        matOk = Object.entries(def.upgrade.cost || {}).every(([g, q]) => (state.resources[g] || 0) >= q);
      } catch (e) { /* 忽略 */ }
      const occNow = Math.round(b.occupied || 0);
      const cap = def.capacity || 1;
      const pop = state.population[def.tier];
      const needSats = (pop && pop.needSats) || {};
      const tierDef = Engine.tiers.TIERS[def.tier];
      const basicList = tierDef ? Object.entries(tierDef.needs || {}).filter(([, n]) => n.influx).map(([g]) => {
        const gn = Engine.goods.name(g);
        return ((needSats[g] ?? 0) >= 0.999 ? '✅' : '❌') + gn;
      }).join(' ') : '✅ 无';
      const costList = Object.entries(def.upgrade.cost || {}).map(([g, q]) =>
        ((state.resources[g] || 0) >= q ? '✅' : '❌') + Engine.goods.name(g) + '×' + q).join(' ');
      html += '<div class="up-list">' +
        (fullOk ? '✅' : '❌') + ' 满员 ' + occNow + '/' + cap + '<br>' +
        (basicOk ? '✅' : '❌') + ' 基础需求 ' + basicList + '<br>' +
        (matOk ? '✅' : '❌') + ' 建材 ' + costList + '</div>';
      const canUp = fullOk && basicOk && matOk;
      html += '<button id="btn-upgrade-residence" class="mini-btn' + (canUp ? '' : ' disabled') + '" style="margin-top:8px"' + (canUp ? '' : ' disabled') + '>🔧 升级为' + (up ? up.name : def.upgrade.to) +
        (costTxt ? ' (' + costTxt + ')' : '') + '</button>';
    }
    // [V1.10 修订⑤ 顺序23] 移动建筑入口已移至工具条(选择式);此处仅保留升级回调
    el.innerHTML = html;
    const upBtn = el.querySelector('#btn-upgrade-residence');
    if (upBtn && onUpgrade) upBtn.onclick = () => onUpgrade(buildingId);
  }

  // [M-06] 通知分级(红=必须处理/黄=即将发生/绿=恢复/灰=普通)
  function appendLog(el, msg) {
    let cls = 'log-line log-gray';
    if (/⚠️|断开|未连通/.test(msg)) cls = 'log-line log-red';
    else if (/不足|缺少|等待|超范围|开发度/.test(msg)) cls = 'log-line log-yellow';
    else if (/开始生产|恢复|成功/.test(msg)) cls = 'log-line log-green';
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = msg;
    el.prepend(div);
    while (el.children.length > 50) el.removeChild(el.lastChild);
  }

  // [M-06] 日志按原因模板聚合:同模板合并显示「原木厂×2、纺织厂:缺少原料(羊毛)」
  function updateLog(el, state) {
    el.innerHTML = '';
    const groups = []; // { tpl, names: [{name, n}] }
    for (const m of state.log.slice(-50)) {
      const idx = m.search(/[:：]/);
      let name = '', tpl = m;
      if (idx > 0) {
        name = m.slice(0, idx).replace(/[⚠️⏳✅]/g, '').trim();
        tpl = m.slice(idx);
      }
      let g = groups.find((x) => x.tpl === tpl);
      if (!g) { g = { tpl, names: [] }; groups.push(g); }
      if (name) {
        const ex = g.names.find((n) => n.name === name);
        if (ex) ex.n++;
        else g.names.push({ name, n: 1 });
      }
    }
    // 渲染:聚合行(建筑名×N + 模板 + 总×N)
    for (const g of groups) {
      let total = 0;
      const nameParts = g.names.map((n) => { total += n.n; return n.name + (n.n > 1 ? '×' + n.n : ''); });
      const prefix = nameParts.slice(0, 2).join('、') + (nameParts.length > 2 ? ' 等' : '');
      const text = (prefix ? prefix + ':' : '') + g.tpl.replace(/^[:：]/, '') + (total > 1 ? ' ×' + total : '');
      appendLog(el, text);
    }
  }

  // [UI] 建筑状态摘要:生产中/等待/断连 计数
  // [H-04] 计数可点击展开异常建筑列表;onLocate(id, dir) 由 main 提供定位与切换
  // [H-04 fix] 展开后每 tick 用最新状态重算列表(建筑恢复/原因变化/被拆除立即反映,不残留陈旧条目)
  let issueFilter = null; // 当前展开的过滤器('waiting'/'disconnected'/null)
  let issueIdx = 0; // 当前查看的条目下标(列表变化时 clamp)
  const reasonCn = {
    'road-disconnected': '断连', 'no-road': '无路', 'workforce-shortage': '缺人力', 'input-shortage': '缺原料',
    'warehouse-out-of-range': '超范围', 'development-too-low': '开发度过高',
  };
  function renderIssues(el, state, items, onLocate) {
    if (!el) return;
    if (!items.length) { el.innerHTML = '<div class="issue-empty">暂无此类异常 ✓</div>'; issueIdx = 0; return; }
    if (issueIdx >= items.length) issueIdx = items.length - 1;
    const it = items[issueIdx];
    const def = Engine.buildings.getDef(it.type);
    el.innerHTML =
      '<div class="issue-item" id="issue-item-0">' +
      '<span class="issue-name">' + (def ? def.name : it.type) + '</span>' +
      '<span class="issue-reason">' + (reasonCn[it.reason] || it.status) + '</span>' +
      '</div>' +
      '<div class="issue-nav"><button id="issue-prev">⬅ 上一栋</button>' +
      '<button id="issue-next">➡ 下一栋</button><span class="issue-pos">' + (issueIdx + 1) + '/' + items.length + '</span></div>';
    const itemEl = el.querySelector('#issue-item-0');
    if (itemEl) itemEl.onclick = () => onLocate && onLocate(it.id, items);
    const prev = el.querySelector('#issue-prev');
    const next = el.querySelector('#issue-next');
    if (prev) prev.onclick = () => { issueIdx = (issueIdx - 1 + items.length) % items.length; renderIssues(el, state, items, onLocate); if (onLocate) onLocate(items[issueIdx].id, items); };
    if (next) next.onclick = () => { issueIdx = (issueIdx + 1) % items.length; renderIssues(el, state, items, onLocate); if (onLocate) onLocate(items[issueIdx].id, items); };
  }

  function updateStats(el, state, onLocate) {
    const list = [];
    for (const b of Object.values(state.buildings)) {
      if (b.status === 'waiting' || b.status === 'disconnected') list.push(b);
    }
    let producing = 0;
    for (const b of Object.values(state.buildings)) if (b.status === 'producing') producing++;
    const waiting = list.filter((b) => b.status === 'waiting').length;
    const disconnected = list.length - waiting;
    el.innerHTML = '<span class="st-ok">✅ 生产 ' + producing + '</span>' +
      '<button class="st-wait issue-btn" id="issue-wait">⏳ 等待 ' + waiting + '</button>' +
      '<button class="st-warn issue-btn" id="issue-disc">⚠️ 断连 ' + disconnected + '</button>';
    const issueEl = document.getElementById('issue-list');
    const waitBtn = el.querySelector('#issue-wait');
    const discBtn = el.querySelector('#issue-disc');
    if (waitBtn) waitBtn.onclick = () => { issueFilter = 'waiting'; issueIdx = 0; renderIssues(issueEl, state, list.filter((b) => b.status === 'waiting'), onLocate); };
    if (discBtn) discBtn.onclick = () => { issueFilter = 'disconnected'; issueIdx = 0; renderIssues(issueEl, state, list.filter((b) => b.status === 'disconnected'), onLocate); };
    // [H-04 fix] 已展开的列表每 tick 用最新状态重算(建筑恢复→条目消失;原因变化→更新;拆除→移除)
    if (issueFilter) {
      renderIssues(issueEl, state, list.filter((b) => b.status === issueFilter), onLocate);
    }
  }

  function toast(el, msg) {
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    // [V1.10 修订⑤ 顺序22] 追加到 body(而非调用方容器):避免父级 transform 破坏 fixed 居中
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2500);
  }

  root.UI = root.UI || {};
  root.UI.panels = { showBuilding, showPlacementInfo, appendLog, updateLog, updateStats, toast };
})(typeof globalThis !== 'undefined' ? globalThis : this);
