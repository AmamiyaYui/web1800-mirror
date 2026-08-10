/* build-menu.js — 建设区:按阶级切页的建造菜单(页内按 住宅/生产/服务 分组) */
(function (root) {
  'use strict';
  const { TIERS } = root.Engine.tiers;
  const { BUILDINGS } = root.Engine.buildings;
  const st = root.Engine.state;

  const GROUP_ORDER = ['住宅', '居住', '生产', '服务', '基础设施'];
  const TIER_ORDER = ['farmers', 'workers', 'artisans'];
  let activeTier = 'farmers';
  let activeType = null; // [H-06] 当前放置中的建筑(按钮高亮)

  function render(tabsEl, contentEl, state, onSelect) {
    // ---- 一级标签:阶级 ----
    let tabsHtml = '';
    for (const tid of TIER_ORDER) {
      const t = TIERS[tid];
      if (!t) continue;
      const unlocked = !!state.unlocks[tid];
      const cls = 'bb-tab' + (tid === activeTier ? ' active' : '') + (unlocked ? '' : ' locked');
      tabsHtml += '<button class="' + cls + '" data-tier="' + tid + '"' + (unlocked ? '' : ' disabled') + '>' +
        t.name + (unlocked ? '' : ' 🔒') + '</button>';
    }
    tabsEl.innerHTML = tabsHtml;

    // ---- 页内容:该阶级的建筑 + 服务建筑(按建筑自身 tier 归属显示) ----
    // [V1.10 修订⑤ 顺序8] 服务建筑带阶层(仓库/市场/酒吧=农民,学校/教堂=工人,大学/剧院=工匠,
    // 银行/发电厂=工程师,会员俱乐部=投资人;tier 为空的旧数据归 farmers 页)
    // [V1.10 修订⑤ 顺序14] 住宅只能新建农民住宅;工人/工匠等住宅只能从上一级升级获得(原版机制)
    const defs = Object.values(BUILDINGS).filter((d) =>
      (d.tier === activeTier || (d.category === '服务' && !d.tier && activeTier === 'farmers')) &&
      !(d.category === '住宅' && d.tier !== 'farmers'));
    const byCat = {};
    for (const d of defs) (byCat[d.category] = byCat[d.category] || []).push(d);

    if (!defs.length) {
      contentEl.innerHTML = '<div class="bb-empty">该阶层暂无建筑' + (state.unlocks[activeTier] ? '' : '(未解锁)') + '</div>';
    } else {
      let html = '';
      for (const cat of GROUP_ORDER) {
        const list = byCat[cat];
        if (!list || !list.length) continue;
        html += '<div class="bm-group"><span class="bm-label">' + cat + '</span>';
        for (const def of list) {
          // [M-03] 成本图标化:coin:500 wood:10 → 💰500 🪵10;禁用显示具体缺口
          const costEntries = Object.entries(def.cost || {});
          const iconOf = { coin: '💰', wood: '🪵', brick: '🧱', steel: '⚙️', windows: '🪟', concrete: '🏗️' };
          const costText = costEntries.map(([g, q]) => (iconOf[g] || g) + q).join(' ');
          const disabled = !st.canAfford(state, def.cost);
          let costCls = 'bm-cost';
          if (disabled) {
            const missing = costEntries.filter(([g, q]) => (state.resources[g] || 0) < q)
              .map(([g, q]) => (iconOf[g] || g) + '缺' + Math.ceil(q - (state.resources[g] || 0))).join(' ');
            costCls += ' bm-missing';
            html += '<button class="build-btn disabled" data-type="' + def.id + '" disabled title="' + def.name + ' · 缺少 ' + missing + '">' +
              def.name + '<span class="' + costCls + '">' + missing + '</span></button>';
            continue;
          }
          html += '<button class="build-btn' + (activeType === def.id ? ' active' : '') + '" data-type="' + def.id + '" title="' + def.name + ' · ' + costText + '">' +
            def.name + '<span class="' + costCls + '">' + costText + '</span></button>';
        }
        html += '</div>';
      }
      contentEl.innerHTML = html;
      contentEl.querySelectorAll('.build-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeType = btn.dataset.type; // [H-06] 高亮当前放置建筑
          onSelect(btn.dataset.type);
        });
      });
    }

    // ---- 标签切换 ----
    tabsEl.querySelectorAll('.bb-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        activeTier = btn.dataset.tier;
        render(tabsEl, contentEl, state, onSelect);
      });
    });
  }

  const api = { render, getActiveTier: () => activeTier, setActiveType: (t) => { activeType = t; } };
  root.UI = root.UI || {};
  root.UI.buildMenu = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
