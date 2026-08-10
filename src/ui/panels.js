/* panels.js — 建筑信息 / 地形信息 / 事件日志 / toast */
(function (root) {
  'use strict';

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
    if (def.production) {
      // [H-03 fix] 商品/阶层名中文化(不暴露 log/farmers 等内部 ID)
      const tierName = { farmers: '农民', workers: '工人', artisans: '工匠', engineers: '工程师', investors: '投资人' };
      const inT = Object.entries(def.production.inputs || {}).map(([g, q]) => Engine.goods.name(g) + '×' + q).join(', ') || '无';
      const outT = Object.entries(def.production.outputs || {}).map(([g, q]) => Engine.goods.name(g) + '×' + q).join(', ');
      const wf = Object.entries(def.production.workforce || {}).map(([t, q]) => (tierName[t] || t) + ':' + q).join(', ');
      html += '<div>消耗:' + inT + '</div><div>产出:' + outT + '</div><div>劳动力:' + wf + '</div>';
      // [用户要求] 农田/牧场/伐木类:可开发度 + 当前生产效率(开发度=未占用地块占比)
      if (def.production.radius) {
        let dev = 0;
        try { dev = Engine.economy.developmentRatio(state, b, def); } catch (e) { /* 忽略 */ }
        const open = Math.round((1 - dev) * 100);
        const effPct = Math.round(Engine.economy.efficiencyFor(dev) * 100);
        html += '<div>可开发:' + open + '%</div><div>当前效率:' + effPct + '%</div>';
      }
    }
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
    'road-disconnected': '断连', 'workforce-shortage': '缺人力', 'input-shortage': '缺原料',
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
  root.UI.panels = { showBuilding, appendLog, updateLog, updateStats, toast };
})(typeof globalThis !== 'undefined' ? globalThis : this);
