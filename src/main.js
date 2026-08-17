/* main.js — 启动/组装/输入分发(唯一知道全部模块的地方) */
(function (root) {
  'use strict';
  const E = root.Engine;

  // ---- 状态初始化:读档优先 ----
  let state;
  try {
    state = E.save.load();
  } catch (error) {
    if (!error || error.code !== 'MIGRATION_BLOCKED') throw error;
    document.body.setAttribute('data-save-migration-blocked', 'true');
    const blocker = document.createElement('div');
    blocker.id = 'save-migration-blocked';
    blocker.setAttribute('role', 'alert');
    blocker.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#14181f;color:#d7dde5;display:grid;place-items:center;padding:24px;font-family:Microsoft YaHei,sans-serif';
    const panel = document.createElement('div');
    panel.style.cssText = 'max-width:620px;background:#1d232d;border:1px solid #e06c5f;border-radius:12px;padding:24px;line-height:1.7';
    const title = document.createElement('h1');
    title.style.cssText = 'margin:0 0 10px;color:#e0a458;font-size:22px';
    title.textContent = '存档迁移已安全中止';
    const detail = document.createElement('p');
    detail.textContent = error.message + '。原始主存档没有被覆盖，请先释放浏览器存储空间，再重新打开游戏。';
    const link = document.createElement('a');
    link.href = 'save-transfer.html';
    link.style.cssText = 'color:#e0a458';
    link.textContent = '打开存档迁移工具';
    panel.append(title, detail, link);
    blocker.appendChild(panel);
    document.body.appendChild(blocker);
    root.__game = { state: null, saveMigrationBlocked: true, error: error.message };
    return;
  }
  if (state) {
    E.state.addLog(state, '📂 读取存档成功');
  } else {
    state = E.state.createInitialState();
    E.state.addLog(state, '🎮 新游戏开始!铺路建渔场,满足农民需求');
  }
  // [V1.7] 旧档迁移:补时间字段与累加器(旧档无 time/tickAcc)
  if (!state.time) state.time = { day: 1, hour: 0, tickAcc: 0 };
  if (state.time.tickAcc === undefined) state.time.tickAcc = 0;
  // [V1.8] 连通性缓存初始化(旧档/新档统一)
  if (!state._conn) state._conn = { dirty: true, ids: {} };
  // [V1.10 修订⑤] 仓库=物流服务建筑(收费),生产建筑须在仓库服务范围内才能生产
  const hasWarehouse = () => Object.values(state.buildings).some((b) => {
    const d = E.buildings.getDef(b.type);
    return d && d.special === 'warehouse';
  });

  // ---- 渲染器 ----
  const canvas = document.getElementById('map');
  const renderer = root.Render.mapRenderer.createRenderer(canvas, () => state);
  // [紧急修复] 脏标记:暂停/静止时跳过每帧全量重绘(4214 人口大档卡顿);飘字动画期间强制重绘
  let renderDirty = true;
  function markDirty() { renderDirty = true; }
  renderer.focusInitialArea();

  // ---- DOM ----
  // [UI改造 A2+B2] 左侧经济面板拆分为三个 Tab 容器(资源/需求/人口)
  const resEl = document.getElementById('economy-res');
  const needEl = document.getElementById('economy-need');
  const popEl = document.getElementById('economy-pop');
  const goalEl = document.getElementById('goal');
  const tabsEl = document.getElementById('build-tabs');
  const menuEl = document.getElementById('build-menu');
  const logEl = document.getElementById('log');
  const statsEl = document.getElementById('stats');
  const infoEl = document.getElementById('info');
  const timeEl = document.getElementById('time-display');
  const minimapEl = document.getElementById('minimap');

  // ---- 模式 ----
  // [V1.10] 仓库/民居进建筑菜单,开局不再自动赠送;g0 引导从菜单建造仓库
  let mode = 'inspect';
  let buildRot = 0; // 放置朝向(0-3,R 键旋转);锚点始终是建筑几何中心

  // [V1.9] 速度反馈:更新按钮高亮 + 当前速度文字(暂停显示"⏸ 暂停")
  function updateSpeedUI() {
    const speedEl = document.getElementById('speed-display');
    [1, 2, 3].forEach((n) => {
      const btn = document.getElementById('btn-speed-' + n);
      if (!btn) return;
      if (state.settings.speed === n && !state.settings.paused) btn.classList.add('active');
      else btn.classList.remove('active');
    });
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.classList.toggle('active', state.settings.paused);
    if (speedEl) speedEl.textContent = state.settings.paused ? '⏸ 暂停' : '▶ ' + state.settings.speed + 'x';
  }

  function redraw() {
    updateSpeedUI();
    markDirty(); // [紧急修复] 统一由 rAF frame 执行重绘(暂停静止时不再每帧全量重绘)
    if (renderer.markStaticDirty) renderer.markStaticDirty(); // [根治] tick/交互状态变化 → 静态层重建
    root.UI.economy.renderRes(resEl, state);
    root.UI.economy.renderNeeds(needEl, state);
    root.UI.economy.renderPop(popEl, state);
    root.UI.goal.render(goalEl, E.goals.getCurrentGoal(state), (action) => {
      // [M-05] 目标操作:建造类进入放置模式,定位类跳到建筑
      if (!action) return;
      if (action.type === 'build') {
        selectBuilding(action.id);
      } else if (action.type === 'locateId') {
        // [M-05 fix2] 目标直接携带断连建筑 id(定位修复,不重复建造)
        if (state.buildings[action.id]) locateIssue(action.id);
        else root.UI.panels.toast(infoEl, '该建筑已不存在');
      } else if (action.type === 'locate') {
        const b = Object.values(state.buildings).find((x) => x.type === action.id);
        if (b) locateIssue(b.id);
        else root.UI.panels.toast(infoEl, '还没有' + (E.buildings.getDef(action.id) || {}).name + ',先建造一个');
      }
    });
    root.UI.buildMenu.render(tabsEl, menuEl, state, selectBuilding);
    root.UI.panels.updateLog(logEl, state);
    root.UI.panels.updateStats(statsEl, state, locateIssue);
    timeEl.textContent = '第 ' + state.time.day + ' 天 ' + String(state.time.hour).padStart(2, '0') + ':00';
    root.UI.minimap.draw(minimapEl, state, renderer.getCamera(), renderer.getTile(), window.innerWidth, window.innerHeight);
    // [H-05] 实时刷新选中建筑详情(每 tick;被拆除则显示已拆除)
    if (selectedBuildingId) {
      if (state.buildings[selectedBuildingId]) {
        root.UI.panels.showBuilding(infoEl, state, selectedBuildingId, (id) => {
          const r = E.placement.upgradeResidence(state, id);
          if (!r.ok) root.UI.panels.toast(infoEl, r.reason);
          else { root.UI.panels.toast(infoEl, '住宅升级成功'); redraw(); }
        });
        // [B-63] 造船厂订单按钮:下单/取消(事件绑定在 redraw 后,按钮随详情刷新)
        const orderBtn = infoEl.querySelector('#btn-ship-order');
        if (orderBtn) {
          orderBtn.onclick = () => {
            const r = E.ships.submitShipOrder(state, orderBtn.getAttribute('data-shipyard'));
            root.UI.panels.toast(infoEl, r.ok ? '🚢 下单成功(180 tick 建造)' : r.reason);
            redraw();
          };
        }
        infoEl.querySelectorAll('[data-cancel-order]').forEach((btn) => {
          btn.onclick = () => {
            E.ships.cancelShipOrder(state, btn.getAttribute('data-cancel-order'));
            root.UI.panels.toast(infoEl, '订单已取消,费用全额返还');
            redraw();
          };
        });
      } else {
        infoEl.innerHTML = '<div class="panel-title">信息</div><div>(已拆除)</div>';
        selectedBuildingId = null;
        selectedRadius = null;
        renderer.setRadius(null);
      }
    }
  }

  // [H-04] 定位异常建筑:相机居中 + 高亮 + 打开详情(供异常列表点击)
  function locateIssue(buildingId) {
    const b = state.buildings[buildingId];
    if (!b) return;
    const def = E.buildings.getDef(b.type);
    const bb = E.placement.footprintBounds(def, b.x, b.y, b.rot || 0);
    const c = renderer.getCamera();
    renderer.setCamera((bb.x + bb.w / 2 + 0.5) * renderer.getTile() - window.innerWidth / 2, (bb.y + bb.h / 2 + 0.5) * renderer.getTile() - window.innerHeight / 2);
    renderer.setHover({ x: b.x, y: b.y });
    markDirty();
    // 打开详情(复用点击分支逻辑)
    selectedBuildingId = buildingId; // [H-05] 定位即选中,redraw 持续刷新
    setSideTab('right', 'info'); // [UI改造 A2+B2] 定位异常建筑 → 切到详情 tab
    root.UI.panels.showBuilding(infoEl, state, buildingId, (id) => {
      const r = E.placement.upgradeResidence(state, id);
      if (!r.ok) root.UI.panels.toast(infoEl, r.reason);
      else { root.UI.panels.toast(infoEl, '住宅升级成功'); redraw(); }
    });
    selectedRadius = null;
    setTimeout(() => renderer.setHover(null), 1200); // 闪烁效果:1.2s 后取消高亮
  }

  // ---- 游戏循环 [Sol 轮2/AC-17] rAF 跨帧分片调度 ----
  // 每浏览器帧推进一片(逐岛分帧);分片未完成不启动下一世界 tick;complete=true 才计数/自动保存
  let rafId = null;
  let ticks = 0;
  let scheduler = null;
  function pump(ts) {
    rafId = requestAnimationFrame(pump);
    if (!scheduler) return;
    const r = scheduler.frame(ts);
    if (r.complete && r.started) {
      ticks = r.ticks;
      if (ticks % 30 === 0) E.save.save(state);
    }
  }
  function startTimer() {
    cancelAnimationFrame(rafId);
    ticks = 0;
    scheduler = E.tick.createScheduler(state);
    rafId = requestAnimationFrame(pump);
  }

  // ---- 输入 [V1.1] 拖拽铺路/拆除 + 放置预览 + 服务范围 ----
  // [V1.5] 右键拖拽平移视野(相机)
  let panning = null; // { startX, startY, camX, camY }
  let rightDownPos = null; // [H-06] 右键按下位置(右键单击取消判定)
  let painting = false;
  let selectedRadius = null; // [用户要求] 点击选中后常驻的范围圆(服务/开发度)
  let selectedBuildingId = null; // [H-05] 选中建筑 id(redraw 时实时刷新详情)
  let downPos = null;
  let lastPaintTile = null;
  // [V1.10 修订⑤ 顺序3] 铺路等级:1=土路(默认) 2=石板路(服务传播 1.5 倍);由 UI 切换
  let roadLevel = 1;

  // [V1.10 修订⑤ 顺序13] 道路费用:土路 3/格;石板路只能升级已有土路(12/格)
  function roadPay(level) {
    const cost = E.balance.ROAD_COST[level === 2 ? 'stone' : 'dirt'];
    if ((state.resources.coin || 0) < cost) return -1;
    state.resources.coin -= cost;
    return cost;
  }

  // 拖拽/点击执行:铺路、拆除(仅这两模式支持连续操作)
  function paint(t) {
    const k = E.state.key(t.x, t.y);
    if (mode === 'road') {
      const existing = state.roads[k];
      if (roadLevel === 2) {
        // 石板路:不能直接建造,只能在土路上升级(12/格)
        if (existing !== 1) {
          root.UI.panels.toast(infoEl, '石板路需在已有土路上升级');
          return true;
        }
        if (roadPay(2) < 0) { root.UI.panels.toast(infoEl, '资金不足'); return true; }
        const r = E.placement.setRoad(state, t.x, t.y, true, 2);
        if (!r.ok) { state.resources.coin += E.balance.ROAD_COST.stone; root.UI.panels.toast(infoEl, r.reason); }
        return true;
      }
      // 土路:建造 3/格(已有路不重复扣费)
      if (existing) return true;
      if (roadPay(1) < 0) { root.UI.panels.toast(infoEl, '资金不足'); return true; }
      const r = E.placement.setRoad(state, t.x, t.y, true, 1);
      if (!r.ok) { state.resources.coin += E.balance.ROAD_COST.dirt; root.UI.panels.toast(infoEl, r.reason); }
      return true;
    }
    if (mode === 'demolish') {
      const id = state.grid[k];
      if (id) {
        // [B-63] 拆除造船厂:自动取消其未完工订单(全额返还,REQ-39)
        if (state.buildings[id] && state.buildings[id].type === 'sailingShipyard') E.ships.cancelShipyardOrders(state, state.activeIslandId, id);
        E.placement.demolish(state, id);
      }
      else if (state.roads[k]) E.placement.setRoad(state, t.x, t.y, false);
      return true;
    }
    return false;
  }

  function clickAction(t) {
    const k = E.state.key(t.x, t.y);
    if (mode === 'road' || mode === 'demolish') {
      paint(t);
    } else if (mode.startsWith('build:')) {
      const type = mode.slice(6);
      // [V1.10 修订⑤ 顺序17] 点击落在预览绿块内 → 按预览锚点放置(所见即所得:
      // 绿块在哪,建筑就放哪,避免点绿块非锚点位置导致偏移)
      let anchor = t;
      const preview = renderer.getPreview && renderer.getPreview();
      if (preview && preview.ok && preview.type === type) {
        const cells = E.placement.footprint(E.buildings.getDef(type), preview.x, preview.y, preview.rot);
        if (cells.some((c) => c.x === t.x && c.y === t.y)) anchor = { x: preview.x, y: preview.y };
      }
      const r = E.placement.placeBuilding(state, type, anchor.x, anchor.y, buildRot);
      if (!r.ok) root.UI.panels.toast(infoEl, r.reason);
    } else if (mode === 'move') {
      // [用户要求] 选择式移动:第一次点击选择建筑,进入放置阶段
      const selId = state.grid[k] || null;
      if (!selId) {
        root.UI.panels.toast(infoEl, '请点击要移动的建筑');
        return true;
      }
      mode = 'move:' + selId;
      renderer.setPreview(null);
      renderer.setRadius(null);
      selectedBuildingId = null; // [B-47] 移动阶段清除选中,避免 redraw 用旧选中覆盖移动信息卡
      selectedRadius = null;
      const mdef = E.buildings.getDef(state.buildings[selId].type);
      // [B-45] 移动阶段:详情面板显示被移动建筑的信息卡(自动切详情 tab)
      if (mdef) { setSideTab('right', 'info'); root.UI.panels.showPlacementInfo(infoEl, mdef); }
      root.UI.panels.toast(infoEl, '点击目标位置放置' + (mdef && mdef.name ? '(' + mdef.name + ')' : '') + ',R 旋转,Esc 取消');
    } else if (mode.startsWith('move:')) {
      // [V1.10 修订⑤ 顺序23] 移动建筑:点击目标位置(预览绿块内按锚点,同放置)
      const id = mode.slice(5);
      const mv = state.buildings[id];
      if (!mv) { setMode('inspect'); renderer.setPreview(null); return; } // [H-06 fix] 统一 setMode,不写死 'view'
      let anchor = t;
      const preview = renderer.getPreview && renderer.getPreview();
      if (preview && preview.ok && preview.type === mv.type) {
        const cells = E.placement.footprint(E.buildings.getDef(mv.type), preview.x, preview.y, preview.rot);
        if (cells.some((c) => c.x === t.x && c.y === t.y)) anchor = { x: preview.x, y: preview.y };
      }
      const r = E.placement.moveBuilding(state, id, anchor.x, anchor.y, buildRot);
      if (!r.ok) root.UI.panels.toast(infoEl, r.reason);
      else {
        root.UI.panels.toast(infoEl, '🚚 ' + E.buildings.getDef(mv.type).name + ' 已移动');
        setMode('inspect'); // [H-06 fix] 移动成功 → 统一 setMode('inspect')(按钮高亮/提示条清空/内部模式同步)
        renderer.setPreview(null);
        renderer.setRadius(null);
      }
    } else {
      // [V1.10 修订⑤ 顺序14] 住宅升级入口:点击升级按钮 → 引擎升级(条件不满足给原因)
      // [V1.10 修订⑤ 顺序23] 移动入口:进入移动模式(预览+点击新位置)
      const selId = state.grid[k] || null;
      selectedBuildingId = selId; // [H-05] 记录选中(redraw 实时刷新)
      if (selId) setSideTab('right', 'info'); // [UI改造 A2+B2] 点击建筑 → 自动切到详情 tab
      root.UI.panels.showBuilding(infoEl, state, selId, (id) => {
        const r = E.placement.upgradeResidence(state, id);
        if (!r.ok) root.UI.panels.toast(infoEl, r.reason);
        else {
          root.UI.panels.toast(infoEl, '住宅升级成功');
          redraw();
        }
      });
      // [用户要求] 查看:点击选中后范围圆常驻(点击空白清除)
      const selB = selId ? state.buildings[selId] : null;
      const selDef = selB ? E.buildings.getDef(selB.type) : null;
      if (selB && selDef) {
        selectedRadius = selDef.service
          ? { x: selB.x, y: selB.y, r: selDef.service.radius, type: selDef.service.type }
          : devRadiusFor(selB, selDef);
        renderer.setRadius(selectedRadius);
      } else {
        selectedRadius = null;
        renderer.setRadius(null);
      }
    }
    redraw();
  }

  // [用户要求] 开发度范围:农田/牧场/伐木类(production.radius)的半径圆 + 开发度%(dev 类型)
  function devRadiusFor(b, def) {
    if (!def || !def.production || !def.production.radius) return null;
    let dev = 0;
    try { dev = E.economy.developmentRatio(state, b, def); } catch (e) { /* 忽略 */ }
    return { x: b.x, y: b.y, r: def.production.radius, type: 'dev', dev };
  }

  function updateHover(t) {
    renderer.setHover(t);
    markDirty(); // [紧急修复] hover 变化需重绘(原依赖每帧无条件 draw)
    // 放置预览(幽灵框)[V1.10 修订⑤ 顺序23] 移动模式同放置预览(忽略自身占用)
    if (mode.startsWith('build:')) {
      const type = mode.slice(6);
      renderer.setPreview({ type, x: t.x, y: t.y, rot: buildRot, ok: E.placement.canPlace(state, type, t.x, t.y, buildRot).ok });
    } else if (mode.startsWith('move:')) {
      const mv = state.buildings[mode.slice(5)];
      if (mv) {
        const mdef = E.buildings.getDef(mv.type);
        renderer.setPreview({ type: mv.type, x: t.x, y: t.y, rot: buildRot, ok: E.placement.canPlace(state, mv.type, t.x, t.y, buildRot, mv.id, true).ok }); // [B-51] 移动预览不因资源不足变红
        if (mdef && mdef.service) renderer.setRadius({ x: t.x, y: t.y, r: mdef.service.radius, type: mdef.service.type });
        else if (mdef && mdef.production && mdef.production.radius) {
          // [用户要求] 移动预览:开发度范围圆(跟随新位置)
          // [B-56] 预览把自身 footprint 计入占用(与放置后一致,避免预览 100%/放置后打折)
          const ph = { x: t.x, y: t.y, rot: buildRot };
          const phCells = E.placement.footprint(mdef, t.x, t.y, buildRot);
          renderer.setRadius({ x: t.x, y: t.y, r: mdef.production.radius, type: 'dev', dev: E.economy.developmentRatio(state, ph, mdef, { selfCells: phCells }) });
        }
        else renderer.setRadius(null);
      } else {
        renderer.setPreview(null);
        renderer.setRadius(null);
      }
    } else {
      renderer.setPreview(null);
    }
    // 服务范围圆:悬停服务建筑 或 预览服务建筑;开发度圆:农田/牧场/伐木类
    const k = E.state.key(t.x, t.y);
    const hovered = state.grid[k] ? state.buildings[state.grid[k]] : null;
    const hdef = hovered ? E.buildings.getDef(hovered.type) : null;
    if (hdef && hdef.service) {
      renderer.setRadius({ x: hovered.x, y: hovered.y, r: hdef.service.radius, type: hdef.service.type });
    } else if (hdef && hdef.production && hdef.production.radius) {
      // [用户要求] 查看/悬停:开发度范围圆
      renderer.setRadius(devRadiusFor(hovered, hdef));
    } else if (mode.startsWith('build:')) {
      const pdef = E.buildings.getDef(mode.slice(6));
      if (pdef && pdef.service) renderer.setRadius({ x: t.x, y: t.y, r: pdef.service.radius, type: pdef.service.type });
      else if (pdef && pdef.production && pdef.production.radius) {
        // [用户要求] 建造预览:开发度范围圆(未放置,按当前区域算)
        // [B-56] 预览把自身 footprint 计入占用(与放置后一致,避免预览 100%/放置后打折)
        const ph = { x: t.x, y: t.y, rot: buildRot };
        const phCells = E.placement.footprint(pdef, t.x, t.y, buildRot);
        renderer.setRadius({ x: t.x, y: t.y, r: pdef.production.radius, type: 'dev', dev: E.economy.developmentRatio(state, ph, pdef, { selfCells: phCells }) });
      }
      else renderer.setRadius(null);
    } else {
      renderer.setRadius(null);
    }
    // [用户要求] 查看常驻:鼠标移开选中建筑后仍显示其范围圆(点击空白清除)
    // [修复] 放置模式(build:)跳过常驻覆盖:拖出建筑时鼠标路径常经过服务建筑,旧覆盖残留致放大级别逐格绘制卡死
    if (!hovered && !hdef && selectedRadius && mode !== 'move' && !mode.startsWith('move:') && !mode.startsWith('build:')) {
      renderer.setRadius(selectedRadius);
    }
    markDirty();
  }

  canvas.addEventListener('wheel', (e) => {
    // [V1.10 修订⑤ 顺序18] 滚轮缩放视口(焦点缩放)
    e.preventDefault();
    renderer.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    markDirty();
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { // [V1.5] 右键 → 开始平移视野
      const c = renderer.getCamera();
      panning = { startX: e.clientX, startY: e.clientY, camX: c.x, camY: c.y };
      rightDownPos = { x: e.clientX, y: e.clientY }; // [H-06] 右键单击取消判定
      canvas.style.cursor = 'grabbing';
      return;
    }
    painting = true;
    downPos = { x: e.clientX, y: e.clientY };
    lastPaintTile = renderer.tileAt(e.clientX, e.clientY);
    paint(lastPaintTile);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (panning) { // [V1.5] 平移视野[性能 C:不直接 draw,rAF 主循环每帧统一重绘,帧内自动合并多次 mousemove]
      renderer.setCamera(
        panning.camX - (e.clientX - panning.startX),
        panning.camY - (e.clientY - panning.startY)
      );
      markDirty(); // [紧急修复] 平移中逐帧重绘(脏标记驱动)
      return;
    }
    const t = renderer.tileAt(e.clientX, e.clientY);
    if (painting && (t.x !== lastPaintTile.x || t.y !== lastPaintTile.y)) {
      lastPaintTile = t;
      paint(t);
    }
    updateHover(t);
  });
  window.addEventListener('error', (ev) => {
    // [诊断] 全局错误可见(玩家卡死时错误不再静默)
    document.title = 'JS错误: ' + (ev.message || '') + ' @' + (ev.filename || '').split('/').pop() + ':' + (ev.lineno || '');
  });
  canvas.addEventListener('mouseup', (e) => {
    if (panning) { // [V1.5] 结束平移
      panning = null;
      canvas.style.cursor = 'default';
      return;
    }
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    painting = false;
    if (moved < 5) clickAction(renderer.tileAt(e.clientX, e.clientY));
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // [V1.5] 禁用右键菜单
    // [H-06] 右键单击(按下后无拖拽)= 取消当前模式;右键拖拽平移保留
    if (e.button === 2 && rightDownPos) {
      const moved = Math.hypot(e.clientX - rightDownPos.x, e.clientY - rightDownPos.y);
      rightDownPos = null;
      if (moved < 5 && mode !== 'inspect') {
        panning = null;
        canvas.style.cursor = 'default';
        setMode('inspect');
        root.UI.panels.toast(infoEl, '已取消,回到查看');
      }
    }
  });
  // [玩家反馈] 第①层页面手势做满:全页禁右键菜单/中键自动滚动/拖拽(插件与系统手势页面层无法拦截)
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); }); // 中键点击(防自动滚动)
  canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // 中键按下(防自动滚动开始)
  document.addEventListener('dragstart', (e) => e.preventDefault()); // 防拖拽 canvas/图片/文本
  canvas.addEventListener('mouseleave', () => {
    painting = false;
    panning = null;
    canvas.style.cursor = 'default';
    renderer.setHover(null);
    renderer.setPreview(null);
    renderer.setRadius(null);
    markDirty();
  });

  function selectBuilding(type) {
    // [V1.10 修订⑤] 仓库进建筑菜单(开局空地);不再强制"先放初始仓库"
    // [H-06 fix] 走 setMode:模式提示条(正在放置/成本/R/Esc)+ 按钮高亮同步
    setMode('build:' + type);
  }

  // [V1.10 修订⑤ 顺序11] R 键旋转放置朝向(建造/移动模式;旋转后刷新当前预览)
  // [H-06] 移动模式 R 也生效;Esc 统一取消建造/移动/铺路/拆除
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (mode !== 'inspect') { setMode('inspect'); root.UI.panels.toast(infoEl, '已取消,回到查看'); }
      return;
    }
    if ((ev.key === 'r' || ev.key === 'R') && (mode.startsWith('build:') || mode.startsWith('move:'))) {
      buildRot = (buildRot + 1) % 4;
      const cur = renderer.getPreview && renderer.getPreview();
      const type = mode.startsWith('build:') ? mode.slice(6) : (state.buildings[mode.slice(5)] || {}).type;
      if (cur && type) {
        renderer.setPreview({ type, x: cur.x, y: cur.y, rot: buildRot, ok: E.placement.canPlace(state, type, cur.x, cur.y, buildRot, mode.startsWith('move:') ? mode.slice(5) : undefined, mode.startsWith('move:')).ok }); // [B-51] 移动旋转预览跳过资源检查
      }
      redraw();
    }
  });

  // ---- 控件 ----
  function setMode(m) {
    // [V1.10 修订⑤] 工具自由使用(仓库=菜单建筑,不再强制先建);hasWarehouse 仅 g0 目标引导
    mode = m;
    root.UI.mode.set(m === 'inspect' ? 'inspect' : (m.startsWith('build:') ? 'build' : m));
    renderer.setPreview(null);
    renderer.setRadius(null);
    root.UI.buildMenu.setActiveType(m.startsWith('build:') ? m.slice(6) : null); // [H-06] 建筑按钮高亮跟随模式
    // [B-45] 放置模式:详情面板显示该建筑完整信息卡(自动切详情 tab)
    // [B-47] 放置模式与"查看选中"互斥:清除 selectedBuildingId,避免 redraw 每 tick 用旧选中覆盖信息卡
    if (m.startsWith('build:')) {
      selectedBuildingId = null;
      selectedRadius = null;
      renderer.setRadius(null);
      const pd = E.buildings.getDef(m.slice(6));
      if (pd) { setSideTab('right', 'info'); root.UI.panels.showPlacementInfo(infoEl, pd); }
    }
    redraw(); // [H-06] 立即重渲染(菜单按钮高亮/提示条即时生效,不等下一 tick)
    // [H-06] 模式提示条:持续显示当前操作与按键说明(与实际键位一致:Esc 取消,R 旋转)
    const hintEl = document.getElementById('mode-hint');
    if (hintEl) {
      if (m.startsWith('build:')) {
        const pd = E.buildings.getDef(m.slice(6));
        // [H-06 fix] 分资源图标映射(wood/coin/brick/steel/windows/concrete),不再全显示木材
        const COST_ICON = { coin: '💰', wood: '🪵', brick: '🧱', steel: '⚙️', windows: '🪟', concrete: '🏗️' };
        const costTxt = pd ? Object.entries(pd.cost || {}).map(([g, q]) => (COST_ICON[g] || '🪵') + q).join(' ') : '';
        hintEl.textContent = '正在放置:' + (pd ? pd.name : m.slice(6)) + (costTxt ? '｜' + costTxt : '') + '｜R 旋转｜Esc 取消';
      } else if (m === 'move') {
        hintEl.textContent = '移动建筑:点击建筑 → 点击目标位置｜R 旋转｜Esc 取消';
      } else if (m === 'road') {
        hintEl.textContent = '铺路:点击/拖拽铺路｜土路 3/格｜Esc 取消';
      } else if (m === 'demolish') {
        hintEl.textContent = '拆除:点击建筑拆除(金币不返还,其余资源 100% 返还)｜Esc/右键取消';
      } else {
        hintEl.textContent = '';
      }
    }
    // [V1.10 修订⑤ 顺序3] 道路等级切换按钮(仅铺路模式显示)
    const sec = document.getElementById('road-level-sec');
    if (sec) sec.style.display = m === 'road' ? 'inline' : 'none';
  }
  // ---- 侧栏伸缩 + Tab 切换 [UI改造 A2+B2] ----
  const sidebarEl = document.getElementById('sidebar');
  const rightEl = document.getElementById('right');
  function setSideTab(side, tab) {
    const rootEl = side === 'left' ? sidebarEl : rightEl;
    if (!rootEl) return;
    rootEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    rootEl.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
    try { localStorage.setItem('ui.' + side + 'Tab', tab); } catch (e) { /* 隐私模式忽略 */ }
  }
  function setSideCollapsed(side, collapsed) {
    const rootEl = side === 'left' ? sidebarEl : rightEl;
    if (!rootEl) return;
    rootEl.classList.toggle('collapsed', !!collapsed);
    try { localStorage.setItem('ui.' + side + 'Collapsed', collapsed ? '1' : '0'); } catch (e) { /* 忽略 */ }
  }
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.onclick = () => {
      setSideTab(btn.dataset.side, btn.dataset.tab);
      setSideCollapsed(btn.dataset.side, false); // [A2] 收起态点击图标 → 展开并切到对应面板
    };
  });
  document.getElementById('btn-side-collapse').onclick = () => setSideCollapsed('left', !sidebarEl.classList.contains('collapsed'));
  document.getElementById('btn-right-collapse').onclick = () => setSideCollapsed('right', !rightEl.classList.contains('collapsed'));
  // 恢复上次会话的 Tab / 收起状态
  try {
    const ltab = localStorage.getItem('ui.leftTab');
    const rtab = localStorage.getItem('ui.rightTab');
    if (ltab) setSideTab('left', ltab);
    if (rtab) setSideTab('right', rtab);
    if (localStorage.getItem('ui.leftCollapsed') === '1') setSideCollapsed('left', true);
    if (localStorage.getItem('ui.rightCollapsed') === '1') setSideCollapsed('right', true);
  } catch (e) { /* 忽略 */ }

  document.getElementById('btn-inspect').onclick = () => setMode('inspect');
  document.getElementById('btn-move').onclick = () => setMode('move'); // [用户要求] 选择式移动:先选建筑再点目标
  document.getElementById('btn-road').onclick = () => setMode('road');
  document.getElementById('btn-demolish').onclick = () => setMode('demolish');
  // [V1.10 修订⑤ 顺序3] 道路等级切换(铺路模式显示)
  const roadSec = document.getElementById('road-level-sec');
  const btnDirt = document.getElementById('btn-road-dirt');
  const btnStone = document.getElementById('btn-road-stone');
  btnDirt.onclick = () => { roadLevel = 1; btnDirt.classList.add('active'); btnStone.classList.remove('active'); };
  btnStone.onclick = () => { roadLevel = 2; btnStone.classList.add('active'); btnDirt.classList.remove('active'); };
  document.getElementById('btn-pause').onclick = () => {
    state.settings.paused = !state.settings.paused;
    startTimer();
    redraw();
  };
  [1, 2, 3].forEach((n) => {
    document.getElementById('btn-speed-' + n).onclick = () => {
      state.settings.speed = n;
      state.settings.paused = false;
      startTimer();
      redraw();
    };
  });
  document.getElementById('btn-donate').onclick = () => {
    root.UI.panels.toast(infoEl, '打赏链接待配置(占位)');
  };
  // [V1.10 修订⑤ 顺序20] 打赏弹窗:档位 + 微信/支付宝收款码 + 留言板
  const DONATE_TIERS = {
    coffee: { label: '☕ 8.8', wx: 'assets/qrcodes/wx-coffee.png', zfb: 'assets/qrcodes/zfb-coffee.png' },
    meal: { label: '🍜 16.6', wx: 'assets/qrcodes/wx-meal.png', zfb: 'assets/qrcodes/zfb-meal.png' },
    tokens: { label: '🤖 66.6', wx: 'assets/qrcodes/wx-tokens.png', zfb: 'assets/qrcodes/zfb-tokens.png' },
  };
  let donateTier = 'coffee';
  let donatePay = 'wx';
  const donateOverlay = document.getElementById('donate-overlay');
  const donateQR = document.getElementById('donate-qr');
  const msgListEl = document.getElementById('msg-list');
  let adminKey = null; // [V1.10 修订⑤ 顺序20] 管理密钥(仅存内存,不持久化)
  function updateDonateQR() {
    donateQR.src = DONATE_TIERS[donateTier][donatePay];
  }
  async function loadMessages() {
    try {
      const res = await fetch('/api/messages');
      if (!res.ok) throw new Error(String(res.status));
      const list = await res.json();
      if (!list || !list.length) {
        msgListEl.innerHTML = '<div class="donate-msg-empty">还没有留言,来当第一个吧 ✨</div>';
        return;
      }
      const tops = list.filter((m) => !m.parent_id);
      msgListEl.innerHTML = tops.map((m) => {
        const replies = list.filter((r) => r.parent_id === m.id);
        const badge = m.status === 'done' ? '<span class="donate-msg-done">✅ 已处理</span>' : '';
        return '<div class="donate-msg">' +
          '<span class="donate-msg-nick">' + escapeHtml(m.nick || '匿名') + '</span>' +
          '<span class="donate-msg-text">' + escapeHtml(m.text) + '</span>' + badge +
          '<span class="donate-msg-ts">' + fmtTs(m.ts) + '</span>' +
          replies.map((r) =>
            '<div class="donate-msg-reply"><span class="donate-msg-nick dev">' + escapeHtml(r.nick || '') + '</span>' +
            '<span class="donate-msg-text">' + escapeHtml(r.text) + '</span></div>'
          ).join('') +
          '</div>';
      }).join('');
    } catch (e) {
      msgListEl.innerHTML = '<div class="donate-msg-empty">留言板需部署后端后可用(离线版无留言服务)💬</div>';
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTs(ts) {
    const d = new Date(Number(ts));
    return isNaN(d) ? '' : (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  donateOverlay.querySelectorAll('.donate-tier').forEach((btn) => {
    btn.onclick = () => {
      donateTier = btn.getAttribute('data-tier');
      donateOverlay.querySelectorAll('.donate-tier').forEach((b) => b.classList.toggle('active', b === btn));
      updateDonateQR();
    };
  });
  document.getElementById('donate-wx').onclick = () => {
    donatePay = 'wx';
    document.getElementById('donate-wx').classList.add('active');
    document.getElementById('donate-zfb').classList.remove('active');
    updateDonateQR();
  };
  document.getElementById('donate-zfb').onclick = () => {
    donatePay = 'zfb';
    document.getElementById('donate-zfb').classList.add('active');
    document.getElementById('donate-wx').classList.remove('active');
    updateDonateQR();
  };
  document.getElementById('btn-donate-close').onclick = () => donateOverlay.classList.add('hidden');
  document.getElementById('btn-msg-send').onclick = async () => {
    const nick = document.getElementById('msg-nick').value.trim();
    const text = document.getElementById('msg-text').value.trim();
    if (!text) { root.UI.panels.toast(infoEl, '写点内容再投递喵~'); return; }
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick, text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      document.getElementById('msg-text').value = '';
      root.UI.panels.toast(infoEl, '留言已投递,感谢喵~ 🧡');
      loadMessages();
    } catch (e) {
      root.UI.panels.toast(infoEl, '留言发送失败(需部署后端)');
    }
  };
  // 打赏按钮真实入口
  document.getElementById('btn-donate').onclick = () => {
    donateOverlay.classList.remove('hidden');
    updateDonateQR();
  };
  // [V1.10 修订⑤ 顺序23] 独立留言板:按钮 + 关闭 + 打开时加载
  const msgboardOverlay = document.getElementById('msgboard-overlay');
  document.getElementById('btn-msgboard').onclick = () => {
    msgboardOverlay.classList.remove('hidden');
    loadMessages();
  };
  document.getElementById('btn-msgboard-close').onclick = () => msgboardOverlay.classList.add('hidden');
  // [V1.9] 地块图例开关
  document.getElementById('btn-legend').onclick = () => {
    document.getElementById('legend-overlay').classList.remove('hidden');
  };
  document.getElementById('btn-legend-close').onclick = () => {
    document.getElementById('legend-overlay').classList.add('hidden');
  };

  // ---- [B-62] 切岛与世界航图(REQ-33:顶部下拉 + 航图骨架 + 切岛清理) ----
  function islandList() {
    return Object.values(state.islands).sort((a, b) => a.id.localeCompare(b.id));
  }
  function islandSummary(isl) {
    const pop = Object.values(isl.population).reduce((s, p) => s + (p.count || 0), 0);
    return { id: isl.id, name: isl.name || isl.id, pop: Math.round(pop), isActive: isl.id === state.activeIslandId };
  }
  function renderIslandSelect() {
    const sel = document.getElementById('island-select');
    if (!sel) return;
    sel.innerHTML = islandList().map((isl) => {
      const sum = islandSummary(isl);
      return '<option value="' + sum.id + '"' + (sum.isActive ? ' selected' : '') + '>' + escapeHtml(sum.name) + ' (' + sum.pop + '人)</option>';
    }).join('');
  }
  // 世界航图:岛列表 + 舰队区(运输/探索/调遣/编辑入口)
  function renderAtlas() {
    const el = document.getElementById('atlas-islands');
    if (!el) return;
    // [HIGH-5] 全商品选项(运输任意商品)
    const goodOpts = Object.entries((E.goods && E.goods.GOODS) || {})
      .map(([gid, g]) => '<option value="' + gid + '">' + (g.icon || '') + (g.name || gid) + '</option>').join('');
    const goodOptsSel = (cur) => Object.entries((E.goods && E.goods.GOODS) || {})
      .map(([gid, g]) => '<option value="' + gid + '"' + (gid === cur ? ' selected' : '') + '>' + (g.icon || '') + (g.name || gid) + '</option>').join('');
    let html = islandList().map((isl) => {
      const sum = islandSummary(isl);
      return '<div class="atlas-row' + (sum.isActive ? ' active' : '') + '" data-island="' + sum.id + '">' +
        '<span class="atlas-name">🏝️ ' + escapeHtml(sum.name) + '</span>' +
        '<span class="atlas-meta">' + sum.pop + ' 人</span>' +
        (sum.isActive ? '<span class="atlas-cur">当前</span>' : '') +
        '</div>';
    }).join('');
    // [B-63] 舰队区(骨架):船列表 + 退役(仅 idle)
    const fleet = Object.values(state.fleet || {});
    if (fleet.length) {
      html += '<div class="atlas-sec">🚢 舰队</div>';
      html += fleet.map((ship) => {
        const t = E.shipsData && E.shipsData.SHIP_TYPES[ship.type];
        const islName = (state.islands[ship.currentIslandId] || {}).name || ship.currentIslandId;
        const statusTxt = ship.status === 'idle' ? '空闲' : (ship.status === 'relocating' ? '🚀 调遣中' : (ship.status === 'expedition' ? '🧭 探索中' : ship.status));
        let row = '<div class="atlas-row"><span class="atlas-name">⛵ ' + (t ? t.name : ship.type) + '</span>' +
          '<span class="atlas-meta">' + statusTxt + ' · ' + escapeHtml(islName) + '</span>';
        if (ship.status === 'idle') {
          // [B-64/B-68] 空闲船:退役 + 探索发起(四档选择;选项展示成功率与代价)
          const expOpts = [60, 70, 80, 90].map((x) => {
            const t = (E.expeditions && E.expeditions.TIERS) ? E.expeditions.TIERS[x] : null;
            const costTxt = (t && t.cost && Object.keys(t.cost).length)
              ? Object.entries(t.cost).map(([g, n]) => {
                const gd = (E.goods && E.goods.GOODS && E.goods.GOODS[g]) || {};
                return (gd.icon || '') + n + (gd.name || g);
              }).join(' ')
              : '仅帆船';
            return '<option value="' + x + '">' + x + '%档 · 成功率' + (t ? Math.round(t.success * 100) : x) + '%' + (costTxt === '仅帆船' ? ' · ' + costTxt : ' · 需' + costTxt) + '</option>';
          }).join('');
          row += '<select class="exp-tier" data-ship="' + ship.id + '">' + expOpts + '</select>' +
            '<button class="mini-btn" data-go-exp="' + ship.id + '">🧭探索</button>';
          // [HIGH-5] 航线创建(目标岛 + 双槽商品/速率)+ 调遣入口(REQ-39/41);探索/退役保留
          const tgtOpts = islandList().filter((i) => i.id !== ship.currentIslandId)
            .map((i) => '<option value="' + i.id + '">' + escapeHtml(i.name) + '</option>').join('');
          row += '<span class="rt-create">' +
            '<select class="exp-tier" data-rt-target="' + ship.id + '">' + (tgtOpts || '<option value="">无目标</option>') + '</select>' +
            '<select class="exp-tier" data-rt-good="' + ship.id + '">' + goodOpts + '</select>' +
            '<input type="number" class="exp-tier" data-rt-rate="' + ship.id + '" value="1" min="0.1" max="5" step="0.1" style="width:42px">' +
            '<select class="exp-tier" data-rt-good2="' + ship.id + '"><option value="">—</option>' + goodOpts + '</select>' +
            '<input type="number" class="exp-tier" data-rt-rate2="' + ship.id + '" value="0" min="0" max="5" step="0.1" style="width:42px">' +
            '<button class="mini-btn" data-create-route="' + ship.id + '">🚚创建航线</button></span>' +
            '<select class="exp-tier" data-relocate-target="' + ship.id + '">' + (tgtOpts || '<option value="">无目标</option>') + '</select>' +
            '<button class="mini-btn" data-relocate-ship="' + ship.id + '">🚀调遣</button>' +
            '<button class="mini-btn" data-retire-ship="' + ship.id + '">退役</button>';
        }
        return row + '</div>';
      }).join('');
    }
    // [B-65] 航线任务区:状态/槽摘要/暂停恢复/取消
    const routes = Object.values(state.transportTasks || {});
    if (routes.length) {
      html += '<div class="atlas-sec">🚚 航线</div>';
      html += routes.map((rt) => {
        const srcName = (state.islands[rt.sourceIslandId] || {}).name || rt.sourceIslandId;
        const tgtName = (state.islands[rt.targetIslandId] || {}).name || rt.targetIslandId;
        const slotsTxt = rt.slots.map((s) => (E.goods.name ? E.goods.name(s.good) : s.good) + ' ' + s.rate + '/min').join(' + ');
        const stTxt = rt.userPaused ? '⏸ 已暂停' : (rt.blockedReason ? '🚧 码头阻塞' : '🚚 运输中');
        return '<div class="atlas-row"><span class="atlas-name">' + stTxt + ' ' + escapeHtml(srcName) + '→' + escapeHtml(tgtName) + '</span>' +
          '<span class="rt-edit">' +
          '<select class="exp-tier" data-eg="' + rt.id + '">' + goodOptsSel(rt.slots[0] ? rt.slots[0].good : '') + '</select>' +
          '<input type="number" class="exp-tier" data-er="' + rt.id + '" value="' + (rt.slots[0] ? rt.slots[0].rate : 0) + '" min="0" max="5" step="0.1" style="width:42px">' +
          '<select class="exp-tier" data-eg2="' + rt.id + '"><option value="">—</option>' + goodOptsSel(rt.slots[1] ? rt.slots[1].good : '') + '</select>' +
          '<input type="number" class="exp-tier" data-er2="' + rt.id + '" value="' + (rt.slots[1] ? rt.slots[1].rate : 0) + '" min="0" max="5" step="0.1" style="width:42px">' +
          '<button class="mini-btn" data-edit-route="' + rt.id + '">✏️保存</button></span>' +
          (rt.userPaused
            ? '<button class="mini-btn" data-resume-route="' + rt.id + '">恢复</button>'
            : '<button class="mini-btn" data-pause-route="' + rt.id + '">暂停</button>') +
          '<button class="mini-btn" data-cancel-route="' + rt.id + '">取消</button></div>';
      }).join('');
    }
    // [B-64] 探索任务区:进度 + 放弃
    const exps = Object.values(state.expeditionTasks || {});
    if (exps.length) {
      html += '<div class="atlas-sec">🧭 探索中</div>';
      html += exps.map((t) => {
        const mins = Math.ceil(t.remaining / 60);
        return '<div class="atlas-row"><span class="atlas-name">🧭 ' + t.tier + '% 档</span>' +
          '<span class="atlas-meta">剩余 ' + mins + ' 分钟</span>' +
          '<button class="mini-btn" data-abort-exp="' + t.id + '">放弃</button></div>';
      }).join('');
    }
    el.innerHTML = html;
    el.querySelectorAll('.atlas-row[data-island]').forEach((row) => {
      row.onclick = () => {
        switchIsland(row.getAttribute('data-island'));
        document.getElementById('atlas-overlay').classList.add('hidden');
      };
    });
    // [B-63] 舰队退役按钮(仅 idle;返还 20 木+10 帆到停留岛)
    el.querySelectorAll('[data-retire-ship]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const r = E.ships.retireShip(state, btn.getAttribute('data-retire-ship'));
        root.UI.panels.toast(infoEl, r.ok ? '⛵ 船已退役(返还 20 木+10 帆)' : r.reason);
        renderAtlas();
        redraw();
      };
    });
    // [HIGH-5] 调遣(REQ-41):idle 船 → 目标已拥有岛(来源岛需有效码头)
    el.querySelectorAll('[data-relocate-ship]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const shipId = btn.getAttribute('data-relocate-ship');
        const sel = el.querySelector('[data-relocate-target="' + shipId + '"]');
        const target = sel ? sel.value : '';
        if (!target) { root.UI.panels.toast(infoEl, '请选择调遣目标岛'); return; }
        const r = E.ships.relocateShip(state, shipId, target);
        root.UI.panels.toast(infoEl, r.ok ? '🚀 调遣出发(10 分钟,途中支付维护)' : r.reason);
        renderAtlas();
        redraw();
      };
    });
    // [HIGH-5] 航线编辑(REQ-39):双槽商品/速率热编辑,下一完整 tick 原子生效
    el.querySelectorAll('[data-edit-route]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const taskId = btn.getAttribute('data-edit-route');
        const g1 = el.querySelector('[data-eg="' + taskId + '"]');
        const r1 = parseFloat((el.querySelector('[data-er="' + taskId + '"]') || {}).value) || 0;
        const g2 = el.querySelector('[data-eg2="' + taskId + '"]');
        const r2 = parseFloat((el.querySelector('[data-er2="' + taskId + '"]') || {}).value) || 0;
        const slots = [];
        if (g1 && g1.value && r1 > 0) slots.push({ good: g1.value, rate: r1 });
        if (g2 && g2.value && r2 > 0) slots.push({ good: g2.value, rate: r2 });
        if (!slots.length) { root.UI.panels.toast(infoEl, '至少保留一个有效槽位(商品+速率>0)'); return; }
        const r = E.transport.editTransportTask(state, taskId, slots);
        root.UI.panels.toast(infoEl, r.ok ? '✏️ 航线已保存(下一完整 tick 生效)' : r.reason);
        renderAtlas();
        redraw();
      };
    });
    // [B-64] 探索发起(四档)/放弃
    el.querySelectorAll('[data-go-exp]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const shipId = btn.getAttribute('data-go-exp');
        const sel = el.querySelector('[data-ship="' + shipId + '"]');
        const tier = sel ? sel.value : '60';
        const r = E.expeditions.startExpedition(state, shipId, tier);
        root.UI.panels.toast(infoEl, r.ok ? '🧭 探索已出发(10 分钟,暂停仍推进)' : r.reason);
        renderAtlas();
        redraw();
      };
    });
    el.querySelectorAll('[data-abort-exp]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        E.expeditions.abortExpedition(state, btn.getAttribute('data-abort-exp'));
        root.UI.panels.toast(infoEl, '探索已放弃(投入不返还)');
        renderAtlas();
        redraw();
      };
    });
    // [B-65/HIGH-5] 航线:创建(双槽)/暂停/恢复/取消(下一完整 tick 生效)
    el.querySelectorAll('[data-create-route]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const shipId = btn.getAttribute('data-create-route');
        const tgt = el.querySelector('[data-rt-target="' + shipId + '"]');
        const g1 = el.querySelector('[data-rt-good="' + shipId + '"]');
        const r1 = parseFloat((el.querySelector('[data-rt-rate="' + shipId + '"]') || {}).value) || 0;
        const g2 = el.querySelector('[data-rt-good2="' + shipId + '"]');
        const r2 = parseFloat((el.querySelector('[data-rt-rate2="' + shipId + '"]') || {}).value) || 0;
        const slots = [];
        if (g1 && g1.value && r1 > 0) slots.push({ good: g1.value, rate: r1 });
        if (g2 && g2.value && r2 > 0) slots.push({ good: g2.value, rate: r2 });
        if (!slots.length) {
          root.UI.panels.toast(infoEl, '请配置至少一个货仓槽(商品+速率>0)');
          return;
        }
        const r = E.transport.createTransportTask(state, shipId, tgt ? tgt.value : '', slots);
        root.UI.panels.toast(infoEl, r.ok ? '🚚 航线已创建(下一边界开始运输)' : r.reason);
        renderAtlas();
        redraw();
      };
    });
    el.querySelectorAll('[data-pause-route]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        E.transport.pauseTransportTask(state, btn.getAttribute('data-pause-route'));
        root.UI.panels.toast(infoEl, '航线已暂停(下一边界生效,维护照付)');
        renderAtlas();
        redraw();
      };
    });
    el.querySelectorAll('[data-resume-route]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        E.transport.resumeTransportTask(state, btn.getAttribute('data-resume-route'));
        root.UI.panels.toast(infoEl, '航线已恢复');
        renderAtlas();
        redraw();
      };
    });
    el.querySelectorAll('[data-cancel-route]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        E.transport.cancelTransportTask(state, btn.getAttribute('data-cancel-route'));
        root.UI.panels.toast(infoEl, '航线已取消,船将在下一边界空闲');
        renderAtlas();
        redraw();
      };
    });
  }
  // [B-62] 切岛:换 activeIslandId;清理上一岛选中建筑/范围圆/工具模式/旋转/镜头(REQ-33 不污染新岛)
  function switchIsland(id) {
    if (!state.islands[id] || id === state.activeIslandId) return;
    state.activeIslandId = id;
    selectedBuildingId = null;
    selectedRadius = null;
    renderer.setHover(null); // [紧急修复] 清旧岛悬停高亮(防残留叠加)
    setMode('inspect'); // 重置工具模式 + 预览/半径 + 按钮高亮 + redraw
    renderer.focusInitialArea(); // 镜头定位新岛(清理上一岛镜头状态)
    renderIslandSelect();
    redraw();
  }
  const islandSelectEl = document.getElementById('island-select');
  if (islandSelectEl) islandSelectEl.onchange = (e) => switchIsland(e.target.value);
  document.getElementById('btn-atlas').onclick = () => {
    renderAtlas();
    document.getElementById('atlas-overlay').classList.remove('hidden');
  };
  document.getElementById('btn-atlas-close').onclick = () => {
    document.getElementById('atlas-overlay').classList.add('hidden');
  };
  renderIslandSelect();

  // ---- 存档钩子 ----
  window.addEventListener('beforeunload', () => {
    // [Sol 轮3] 分帧中途退出(含暂停中):补完当前世界 tick,不得序列化半结算状态;不启动新 tick
    E.tick.finishPendingTick(state);
    E.save.save(state);
  });

  // [B-64] 探索独立推进:每真实秒 1 tick,暂停游戏仍推进(REQ-42);关闭页面停止
  setInterval(() => {
    const done = E.expeditions.advanceExpeditions(state);
    if (done.length) {
      for (const d of done) {
        if (d.ok) {
          const name = (state.islands[d.islandId] || {}).name || d.islandId;
          root.UI.panels.toast(infoEl, '🧭 探索成功!获得新岛「' + name + '」(可切换查看)');
        } else {
          root.UI.panels.toast(infoEl, '💥 探索失败,船只与投入损失');
        }
      }
      E.save.save(state); // 探索结果落盘
      redraw();
    }
  }, 1000);

  // ---- 启动 ----
  E.economy.refresh(state, { produce: false, logs: false });
  startTimer(); // [V1.10 修订⑤] 开局即计时(仓库=菜单建筑,非强制放置)
  redraw();
  root.UI.minimap.bind(minimapEl, renderer, () => state); // [V1.8] 小地图点击跳转

  // [V1.6] 每 tick 后刷新面板(时间/经济/目标/日志/建筑菜单)——
  // 此前只在用户交互时刷新,速率与库存显示会滞后
  E.events.on('state-changed', () => redraw());

  // [玩家反馈] 键盘平移:WASD/方向键按住连续移动(帧内执行,与右键拖拽并存)
  const KEY_MOVE = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const keys = {};
  window.addEventListener('keydown', (ev) => {
    if (KEY_MOVE[ev.key]) { keys[ev.key] = true; ev.preventDefault(); } // 方向键防页面滚动
  });
  window.addEventListener('keyup', (ev) => { delete keys[ev.key]; });

  // [V1.2] rAF 循环驱动飘字动画(地图每帧重绘,30×30 开销可忽略)
  // [玩家反馈] 键盘平移并入该帧循环:按住 WASD/方向键每帧移动 ~0.4 格(斜向归一)
  const KBD_SPEED = 0.4; // 格/帧(@60fps ≈ 24 格/秒)
  function frame() {
    let mx = 0, my = 0;
    for (const k of Object.keys(keys)) {
      const d = KEY_MOVE[k];
      if (d) { mx += d[0]; my += d[1]; }
    }
    if (mx || my) {
      const len = Math.hypot(mx, my);
      const tilePx = renderer.getTileSize ? renderer.getTileSize() : 32;
      const c = renderer.getCamera();
      renderer.setCamera(c.x + (mx / len) * KBD_SPEED * tilePx, c.y + (my / len) * KBD_SPEED * tilePx);
      markDirty(); // [紧急修复] 键盘平移逐帧重绘
    }
    // [紧急修复] 脏标记重绘:暂停/静止时跳过全量重绘(4214 人口大档卡顿)
    // [诊断] draw 异常必须可见:捕获并显示在页面(不再静默冻结);错误写入 state 供诊断
    if (renderDirty) {
      try {
        renderer.draw();
        renderDirty = false;
        if (state._drawError) { state._drawError = null; document.title = '蒸汽都市'; }
      } catch (err) {
        renderDirty = false; // [诊断] 不重试(避免每帧抛错重绘死循环);错误可见
        state._drawError = String(err && err.message ? err.message : err) + ' @' + (err && err.stack ? err.stack.split('\n')[1] || '' : '');
        document.title = '渲染错误: ' + state._drawError;
        let dbg = document.getElementById('draw-error');
        if (!dbg) {
          dbg = document.createElement('div');
          dbg.id = 'draw-error';
          dbg.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#c62828;color:#fff;padding:8px;font:12px monospace;white-space:pre-wrap';
          document.body.appendChild(dbg);
        }
        dbg.textContent = '渲染错误: ' + state._drawError;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // [紧急修复] 窗口尺寸变化 → 标记重绘(脏标记模式下 draw 内才检查 canvas 尺寸)
  window.addEventListener('resize', markDirty);

  // [V1.2] 生产链总览开关
  // [V1.10 修订⑤ 顺序21] 欢迎弹窗:每次进入游戏都显示(玩家公告,含最近更新)
  const welcomeOverlay = document.getElementById('welcome-overlay');
  function showWelcome() {
    if (!welcomeOverlay) return;
    welcomeOverlay.classList.remove('hidden');
  }
  document.getElementById('btn-announce').onclick = showWelcome;
  document.getElementById('btn-welcome-start').onclick = () => welcomeOverlay.classList.add('hidden');
  showWelcome();
  document.getElementById('btn-guide').onclick = () => {
    root.UI.guide.render(document.getElementById('guide-list'));
    document.getElementById('guide-overlay').classList.remove('hidden');
  };
  document.getElementById('btn-guide-close').onclick = () => {
    document.getElementById('guide-overlay').classList.add('hidden');
  };
  // [V1.10 修订⑤ 顺序19] 重置存档:弹窗倒计时 10 秒 → 清档 → 重载生成新地图
  const resetModal = document.getElementById('reset-modal');
  const resetCount = document.getElementById('reset-countdown');
  const resetConfirm = document.getElementById('btn-reset-confirm');
  let resetTimer = null;
  document.getElementById('btn-reset').onclick = () => {
    if (resetTimer) clearInterval(resetTimer);
    resetModal.classList.remove('hidden');
    let left = 10;
    resetCount.textContent = String(left);
    resetConfirm.disabled = true;
    resetConfirm.textContent = '确定(' + left + 's)';
    resetTimer = setInterval(() => {
      left--;
      resetCount.textContent = String(Math.max(0, left));
      resetConfirm.textContent = left > 0 ? '确定(' + left + 's)' : '确定';
      if (left <= 0) {
        clearInterval(resetTimer);
        resetTimer = null;
        resetConfirm.disabled = false;
      }
    }, 1000);
  };
  document.getElementById('btn-reset-cancel').onclick = () => {
    if (resetTimer) { clearInterval(resetTimer); resetTimer = null; }
    resetModal.classList.add('hidden');
  };
  resetConfirm.onclick = () => {
    if (resetConfirm.disabled) return;
    // [V1.10 修订⑤ 顺序19 fix] 必须禁用自动存档:reload 会触发 beforeunload → save(state)
    // 把旧档(物品数量/产线设施)写回 localStorage → 否则重置无效(玩家反馈 bug)
    E.save.save = function () {};
    E.save.clearSave();
    location.reload(); // 重载后无存档 → createInitialState 生成新地图
  };
  document.getElementById('btn-chains').onclick = () => {
    root.UI.chainsPanel.render(document.getElementById('chains-list'), E.chains.buildChains());
    document.getElementById('chains-overlay').classList.remove('hidden');
  };
  document.getElementById('btn-chains-close').onclick = () => {
    document.getElementById('chains-overlay').classList.add('hidden');
  };

  // 调试钩子(脚手架阶段;后续可移除)
  root.__game = { state, redraw, getMode: () => mode, renderer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
