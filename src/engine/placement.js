/* placement.js — 放置合法性校验与玩家操作(建造/拆除/铺路)
 * [V1.8 修订②] 多格建筑 footprint:民居/仓库 2×2,其余 3×3;
 * 普通建筑可覆盖树木(数组地形);资源建筑锚点格匹配 + footprint 非水非山;
 * 渔场(沿海)= footprint 任意格邻水。
 */
(function (root) {
  'use strict';
  const { getDef } = root.Engine.buildings;
  const st = root.Engine.state;
  const economy = root.Engine.economy; // 加载顺序:connectivity → economy → placement

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function inBounds(state, x, y) {
    return x >= 0 && y >= 0 && x < state.map.size && y < state.map.size;
  }

  function terrainAt(state, x, y) {
    return state.map.terrain[y][x];
  }

  function isWater(state, x, y) {
    return terrainAt(state, x, y) === 6;
  }

  function isCoastal(state, x, y) {
    if (isWater(state, x, y)) return false;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(state, nx, ny) && isWater(state, nx, ny)) return true;
    }
    return false;
  }

  // 建筑 footprint 覆盖格列表(锚点 = 左上角)
  // [V1.10 修订⑤ 顺序11] 旋转尺寸(锚点=左上角不变;rot: 0=0° 1=顺时针90° 2=180° 3=逆时针90°)
  function rotatedSize(def, rot) {
    const w = (def.size && def.size.w) || 1;
    const h = (def.size && def.size.h) || 1;
    return (rot === 1 || rot === 3) ? { w: h, h: w } : { w, h };
  }
  // 建筑 footprint 格列表[V1.10 修订⑤ 顺序22 用户拍板 B 方案]:
  // 锚点 (x,y) = 建筑几何中心(奇数尺寸精确对称;偶数尺寸偏一格),旋转绕中心——
  // 不再有"建筑甩到锚点一侧"的负偏移怪象,预览/放置/联通所见即所得
  function footprint(def, x, y, rot) {
    const r = ((rot || 0) % 4 + 4) % 4;
    const w0 = (def.size && def.size.w) || 1, h0 = (def.size && def.size.h) || 1;
    const bx = Math.floor((w0 - 1) / 2), by = Math.floor((h0 - 1) / 2);
    const cells = [];
    for (let dy = 0; dy < h0; dy++) for (let dx = 0; dx < w0; dx++) {
      let ox, oy;
      if (r === 0) { ox = dx - bx; oy = dy - by; }
      else if (r === 1) { ox = dy - by; oy = -dx + bx; }   // 顺时针 90°(尺寸交换,中心不动)
      else if (r === 2) { ox = -dx + bx; oy = -dy + by; }  // 180°
      else { ox = -dy + by; oy = dx - bx; }                // 逆时针 90°
      cells.push({ x: x + ox, y: y + oy });
    }
    return cells;
  }
  // 建筑旋转后包围盒(绘制/中心计算用;锚点可不在包围盒左上角)
  function footprintBounds(def, x, y, rot) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of footprint(def, x, y, rot)) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // footprint 地形校验:
  //  - 数组(普通建筑):所有格 ∈ 数组(建筑可覆盖树木)
  //  - 'coast'(渔场):所有格非水非山 + 任意格邻水
  //  - 单资源地形(clay/iron/...):所有格非水非山 + 锚点格匹配
  function terrainOkAll(state, def, cells) {
    const want = def.terrain;
    const T = (v) => {
      switch (v) {
        case 0: return 'plain';
        case 1: return 'forest';
        case 2: return 'clay';
        case 3: return 'iron';
        case 4: return 'copper';
        case 5: return 'gold';
        case 6: return 'water';
        case 7: return 'mountain';
        case 8: return 'coal';
        case 9: return 'zinc';
        case 10: return 'limestone';
        default: return '?';
      }
    };
    if (Array.isArray(want)) {
      for (const c of cells) {
        if (!inBounds(state, c.x, c.y)) return '越界';
        if (!want.includes(T(terrainAt(state, c.x, c.y)))) return '地形不符';
      }
      return null;
    }
    if (want === 'coast') {
      // [V1.10 修订⑤ 顺序10 用户修正] 海岸依赖建筑:任何一点都无法铺在陆地上(footprint 全水格),
      // 且必须依靠海岸建造(至少一格 4 邻接陆地,岸侧铺路接驳)
      let anyLandNb = false;
      for (const c of cells) {
        if (!inBounds(state, c.x, c.y)) return '越界';
        const t = terrainAt(state, c.x, c.y);
        if (t !== 6) return '需沿海(任何一点不可在陆地,footprint 全部在水里)';
        // footprint 外 4 邻至少一格陆地(依靠海岸,可铺路接驳)
        for (const [dx, dy] of DIRS) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!inBounds(state, nx, ny)) continue;
          const nt = terrainAt(state, nx, ny);
          if (nt !== 6 && nt !== 7) anyLandNb = true;
        }
      }
      if (!anyLandNb) return '需邻接陆地(必须依靠海岸建造)';
      return null;
    }
    // 单资源地形(矿类):[用户要求] 建筑与矿完全嵌合——footprint 全部格必须为该矿地形;
    // 矿物格专属:其他建筑 terrain 列表不含矿地形码,天然无法占用矿格
    for (const c of cells) {
      if (!inBounds(state, c.x, c.y)) return '越界';
      if (T(terrainAt(state, c.x, c.y)) !== want) return '需' + want + '地形(建筑须完全位于矿脉上)';
    }
    return null;
  }

  // [B-51] skipCost:移动建筑免费,跳过资源检查(placeBuilding 仍检查)
  function canPlace(state, type, x, y, rot, ignoreId, skipCost) {
    const def = getDef(type);
    if (!def) return { ok: false, reason: '未知建筑' };
    const cells = footprint(def, x, y, rot);
    for (const c of cells) {
      if (!inBounds(state, c.x, c.y)) return { ok: false, reason: '越界' };
      const occ = state.grid[st.key(c.x, c.y)];
      // [顺序23] ignoreId:移动建筑时忽略自身旧占用(新位置与旧位置重叠)
      if ((occ && occ !== ignoreId) || state.roads[st.key(c.x, c.y)]) return { ok: false, reason: '已被占用' };
    }
    const tErr = terrainOkAll(state, def, cells);
    if (tErr) return { ok: false, reason: tErr };
    // [B-63] 码头每岛最多 1 座(REQ-38/MI-10)
    if (type === 'port') {
      for (const b of Object.values(state.buildings || {})) {
        if (b.type === 'port' && b.id !== ignoreId) return { ok: false, reason: '每岛最多 1 座码头' };
      }
    }
    if (!skipCost && !st.canAfford(state, def.cost)) return { ok: false, reason: '资金不足' };
    return { ok: true };
  }

  function placeBuilding(state, type, x, y, rot) {
    const check = canPlace(state, type, x, y, rot);
    if (!check.ok) return check;
    const def = getDef(type);
    st.spend(state, def.cost);
    const b = st.addBuildingRaw(state, type, x, y);
    b.rot = ((rot || 0) % 4 + 4) % 4; // [V1.10 修订⑤ 顺序11] 建筑朝向
    // [B-43] 住宅初始人口 = 0(无保底;人口只由后续 updateNeeds/updatePopulation 按已满足需求增长)
    // (原逻辑 count += capacity 已删除:0 人+0 供应 → 目标 0;有供应 → 按 Influx 目标缓慢增长)
    // 记录 footprint 全部覆盖格(含锚点格)——[玩家反馈] 锚点格不入 grid 导致 BFS 盲区:
    // 建筑仅锚点格邻路时被误判断连;同时锚点格占用检查对后续建筑失效(重叠 bug)
    for (const c of footprint(def, x, y, b.rot)) {
      state.grid[st.key(c.x, c.y)] = b.id;
    }
    root.Engine.connectivity.markDirty(state);
    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)
    const actIsl = state.islands ? state.islands[state.activeIslandId] : state; // [优化] 岛级布局版本(serviceRoads 缓存失效;兼容 world/岛两种调用)
    if (actIsl) actIsl._layoutVer = (actIsl._layoutVer || 0) + 1; // [优化] 岛级布局版本递增
    economy.refresh(state, { produce: false, logs: true });
    st.addLog(state, '建造:' + def.name + ' (' + x + ',' + y + ')');
    return { ok: true, building: b };
  }

  function demolish(state, id) {
    const b = state.buildings[id];
    if (!b) return { ok: false, reason: '不存在' };
    const def = getDef(b.type);
    // [V1.8] 拆除返还:可配置比例(balance.DEMOLISH_REFUND,默认金币 0、其他 100%)
    const refunds = [];
    for (const [g, q] of Object.entries(def.cost || {})) {
      const ratio = root.Engine.balance.refundRatio(g);
      const amount = q * ratio;
      if (amount > 0) {
        state.resources[g] = (state.resources[g] || 0) + amount;
        refunds.push(g + ' +' + amount);
      }
    }
    // 清除 footprint 全部覆盖格
    for (const c of footprint(def, b.x, b.y, b.rot)) {
      if (state.grid[st.key(c.x, c.y)] === id) delete state.grid[st.key(c.x, c.y)];
    }
    st.removeBuildingRaw(state, id);
    root.Engine.connectivity.markDirty(state);
    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)
    const actIsl = state.islands ? state.islands[state.activeIslandId] : state; // [优化] 岛级布局版本(serviceRoads 缓存失效;兼容 world/岛两种调用)
    if (actIsl) actIsl._layoutVer = (actIsl._layoutVer || 0) + 1; // [优化] 岛级布局版本递增
    economy.refresh(state, { produce: false, logs: true });
    st.addLog(state, '拆除:' + def.name + (refunds.length ? ' (返还 ' + refunds.join(' ') + ')' : ''));
    return { ok: true };
  }

  // [V1.10 修订⑤ 顺序23] 移动建筑:释放旧占用 → 校验新位置(ignoreId 忽略自身) → 更新坐标/占用
  // 免费(原版同);住户/状态/升级等数据随建筑保留;移动后可能断连(新位置无路,玩家自行铺路)
  function moveBuilding(state, id, nx, ny, rot) {
    const b = state.buildings[id];
    if (!b) return { ok: false, reason: '建筑不存在' };
    const def = getDef(b.type);
    if (!def) return { ok: false, reason: '未知建筑' };
    const nrot = ((rot || 0) % 4 + 4) % 4;
    if (nx === b.x && ny === b.y && nrot === b.rot) return { ok: false, reason: '位置未变化' };
    const check = canPlace(state, b.type, nx, ny, nrot, id, true); // [B-51] 移动免费:跳过资源检查
    if (!check.ok) return check;
    // 释放旧占用 → 更新坐标 → 写入新占用
    for (const c of footprint(def, b.x, b.y, b.rot)) {
      if (state.grid[st.key(c.x, c.y)] === id) delete state.grid[st.key(c.x, c.y)];
    }
    b.x = nx; b.y = ny; b.rot = nrot;
    for (const c of footprint(def, nx, ny, nrot)) state.grid[st.key(c.x, c.y)] = b.id;
    root.Engine.connectivity.markDirty(state);
    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)
    const actIsl = state.islands ? state.islands[state.activeIslandId] : state; // [优化] 岛级布局版本(serviceRoads 缓存失效;兼容 world/岛两种调用)
    if (actIsl) actIsl._layoutVer = (actIsl._layoutVer || 0) + 1; // [优化] 岛级布局版本递增
    economy.refresh(state, { produce: false, logs: false });
    st.addLog(state, '🚚 ' + def.name + ' 移动到 (' + nx + ',' + ny + ')');
    return { ok: true, building: b };
  }

  function canPlaceRoad(state, x, y) {
    if (!inBounds(state, x, y)) return false;
    const t = terrainAt(state, x, y);
    if (t === 6) return false;                 // 水域不能铺路
    if (t === 7) return false;                 // [V1.8] 山脉不能铺路
    if (state.grid[st.key(x, y)]) return false; // 建筑占位
    return true;
  }

  // [V1.10 修订⑤ 顺序3] 道路等级:1=土路(默认) 2=石板路(服务传播 1.5 倍)
  function setRoad(state, x, y, on, level) {
    if (on && !canPlaceRoad(state, x, y)) return { ok: false, reason: '此处不能铺路' };
    st.setRoad(state, x, y, on, level);
    root.Engine.connectivity.markDirty(state);
    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)
    const actIsl = state.islands ? state.islands[state.activeIslandId] : state; // [优化] 岛级布局版本(serviceRoads 缓存失效;兼容 world/岛两种调用)
    if (actIsl) actIsl._layoutVer = (actIsl._layoutVer || 0) + 1; // [优化] 岛级布局版本递增
    economy.refresh(state, { produce: false, logs: true });
    return { ok: true };
  }

  // [V1.10] 住宅升级(原版:全部基础需求满足 + 消耗建材 → 下一阶层住宅)
  function upgradeResidence(state, id) {
    const b = state.buildings[id];
    if (!b) return { ok: false, reason: '建筑不存在' };
    const def = getDef(b.type);
    if (!def || !def.upgrade) return { ok: false, reason: '该建筑不可升级' };
    const pop = state.population[def.tier];
    if (!pop) return { ok: false, reason: '阶层数据缺失' };
    // [玩家反馈 #4] 条件 0:该栋住宅满员(基础需求满足 → 人口涨满 → 住宅满,原版逻辑)
    root.Engine.population.refreshOccupancy(state); // 先刷新单栋住户分配(放置/人口变化后)
    // [B-43 返工 A] 满员判定用真实 occupied(9.5/10 禁止升级;四舍五入只允许用于文字显示)
    const occ = b.occupied || 0;
    if (occ < def.capacity - 0.001) {
      return { ok: false, reason: '住宅未满员(' + Math.round(occ) + '/' + def.capacity + ')' };
    }
    // 条件 1:全部基础需求满足
    const needSats = pop.needSats || {};
    const tier = root.Engine.tiers.TIERS[def.tier];
    for (const [good, need] of Object.entries(tier.needs || {})) {
      if (!need.influx) continue;
      if ((needSats[good] ?? 0) < 0.999) return { ok: false, reason: '需满足全部基础需求' };
    }
    // 条件 2:建材充足
    const cost = def.upgrade.cost || {};
    for (const [g, q] of Object.entries(cost)) {
      if ((state.resources[g] || 0) < q) return { ok: false, reason: '建材不足' };
    }
    for (const [g, q] of Object.entries(cost)) state.resources[g] -= q;
    st.removeBuildingRaw(state, id); // 清 grid/建筑
    delete state.buildings[id];
    const newDef = getDef(def.upgrade.to);
    const nb = st.addBuildingRaw(state, def.upgrade.to, b.x, b.y);
    // [B-43 返工 B] 人口迁移:迁移该栋真实 occupied(不四舍五入),受旧阶层实际人口与容量限制,总人口严格守恒
    const oldTier = def.tier, newTier = newDef.tier;
    let move = 0;
    if (state.population[oldTier] && state.population[newTier]) {
      move = Math.min(Math.max(0, b.occupied || 0), state.population[oldTier].count, def.capacity);
      state.population[oldTier].count = Math.max(0, state.population[oldTier].count - move);
      state.population[newTier].count += move;
    }
    nb.occupied = move; // [B-43 返工 D] 升级后新住宅立即反映迁移住户(10/20),不依赖后续 refresh
    for (const c of footprint(newDef, b.x, b.y, b.rot)) {
      state.grid[st.key(c.x, c.y)] = nb.id; // 含锚点格(与 placeBuilding 一致)
    }
    root.Engine.connectivity.markDirty(state);
    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)    state._layoutVer = (state._layoutVer || 0) + 1; // [B-67] 布局版本:放置/拆除/移动/铺路/升级后递增(全图缩略缓存失效)
    const actIsl = state.islands ? state.islands[state.activeIslandId] : state; // [优化] 岛级布局版本(serviceRoads 缓存失效;兼容 world/岛两种调用)
    if (actIsl) actIsl._layoutVer = (actIsl._layoutVer || 0) + 1; // [优化] 岛级布局版本递增
    st.addLog(state, '🏘️ ' + def.name + ' 升级为 ' + newDef.name);
    return { ok: true, building: nb };
  }

  const api = { canPlace, placeBuilding, demolish, moveBuilding, canPlaceRoad, setRoad, upgradeResidence, terrainAt, isCoastal, isWater, footprint, rotatedSize, footprintBounds };
  root.Engine = root.Engine || {};
  root.Engine.placement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
