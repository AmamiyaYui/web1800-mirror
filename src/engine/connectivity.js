/* connectivity.js — 仓库洪泛填充(BFS)连通性判定 [V1.8 惰性缓存] */
(function (root) {
  'use strict';
  const { getDef } = root.Engine.buildings;

  function key(x, y) { return x + ',' + y; }

  // [用户模型] 所有仓库 = 总资源池接入点:BFS 从全部仓库出发(不要求仓库间互连;
  // 生产建筑连到任意仓库即连通,货物进总资源池共享)
  function connectedTiles(state) {
    const size = state.map.size;
    const seen = {};
    const queue = [];
    for (const b of Object.values(state.buildings)) {
      const def = getDef(b.type);
      if (def && def.special === 'warehouse') {
        const w = (def.size && def.size.w) || 1, h = (def.size && def.size.h) || 1;
        const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2); // 中心语义
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
          const k = key(b.x - bx + dx, b.y - by + dy);
          seen[k] = true;
          queue.push([b.x - bx + dx, b.y - by + dy]);
        }
      }
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const k = key(nx, ny);
        if (seen[k]) continue;
        const passable = state.roads[k] || state.grid[k];
        if (passable) { seen[k] = true; queue.push([nx, ny]); }
      }
    }
    return seen;
  }

  // [V1.8] 计算连通建筑 id 映射({id: true});多格建筑:footprint 任一格被连通即算连通
  function computeConnections(state) {
    const seen = connectedTiles(state);
    const ids = {};
    for (const b of Object.values(state.buildings)) {
      const def = getDef(b.type);
      let connected = false;
      // [V1.10 修订⑤ 顺序11] 按 b.rot 旋转后的 footprint 判定(多格建筑任一格连通即连通)
      const cells = root.Engine.placement.footprint(def, b.x, b.y, b.rot);
      for (const c of cells) {
        if (seen[key(c.x, c.y)]) { connected = true; break; }
      }
      if (connected) ids[b.id] = true;
    }
    return ids;
  }

  // [V1.8] 拓扑变化(放置/拆除/铺路/拆路)后调用,标记缓存失效
  function markDirty(state) {
    state._conn = { dirty: true, ids: {} };
  }

  // [V1.8] 惰性:首次查询时一次 flood-fill 构建缓存,后续 O(1);避免 65k 格 BFS 每建筑每 tick 重复
  function isConnected(state, buildingId) {
    if (!state._conn || state._conn.dirty) {
      state._conn = { dirty: false, ids: computeConnections(state) };
    }
    return !!state._conn.ids[buildingId];
  }

  const api = { connectedTiles, computeConnections, markDirty, isConnected };
  root.Engine = root.Engine || {};
  root.Engine.connectivity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
