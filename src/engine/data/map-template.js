/* map-template.js — 种子化随机岛屿生成 [V1.8 修订②:山脉双形态 + 3×3 矿床块]
 * 128×128 海洋格内生成完整岛屿:椭圆基座+低频扰动(圆润岛形);
 * 山脉双形态随机: A 山脊横穿(1~2 条线状山脊) / B 岛中央山块(1~2 个大圆盘);
 * 矿脉(铁/铜/金/煤/锌/石灰岩)贴山缘,以 3×3 矿床块生成(与 3×3 矿场匹配);
 * 黏土以 3×3 块生成于海岸带(不贴山);森林地形已移除(用户决策,2026-08-10);
 * 同种子 → 同图。
 */
(function (root) {
  'use strict';

  const T_PLAIN = 0, T_FOREST = 1, T_CLAY = 2, T_IRON = 3, T_COPPER = 4, T_GOLD = 5, T_WATER = 6, T_MOUNTAIN = 7;
  // [修订⑤ 顺序8] 新增矿脉:煤矿(工匠)/锌矿(工程师)/石灰岩矿(工程师),贴山缘 3×3
  const T_COAL = 8, T_ZINC = 9, T_LIMESTONE = 10;
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIRS8 = DIRS4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);

  // ---- 种子化 RNG(mulberry32)----
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 值噪声 ----
  function makeNoise(rng) {
    const G = 64;
    const grid = [];
    for (let i = 0; i <= G; i++) {
      grid.push([]);
      for (let j = 0; j <= G; j++) grid[i].push(rng());
    }
    return function (x, y) {
      const gx = x * G, gy = y * G;
      const x0 = Math.floor(gx) % G, y0 = Math.floor(gy) % G;
      const x1 = (x0 + 1) % G, y1 = (y0 + 1) % G;
      const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = grid[y0][x0] * (1 - sx) + grid[y0][x1] * sx;
      const b = grid[y1][x0] * (1 - sx) + grid[y1][x1] * sx;
      return a * (1 - sy) + b * sy;
    };
  }

  function fbm(sample, x, y, octaves, lacunarity, gain) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += sample(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  // ---- 连通分量(按大小降序)----
  function components(t, size, isLand) {
    const seen = new Uint8Array(size * size);
    const comps = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!isLand(t[y][x]) || seen[y * size + x]) continue;
      const cells = [];
      const q = [[x, y]];
      seen[y * size + x] = 1;
      while (q.length) {
        const [cx, cy] = q.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of DIRS4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (!isLand(t[ny][nx]) || seen[ny * size + nx]) continue;
          seen[ny * size + nx] = 1;
          q.push([nx, ny]);
        }
      }
      comps.push({ cells });
    }
    comps.sort((a, b) => b.cells.length - a.cells.length);
    return comps;
  }

  function inBounds(size, x, y) { return x >= 0 && y >= 0 && x < size && y < size; }

  // 随机取一个"陆地内部点"(距海岸 ≥dist)
  function randomInland(rng, t, size, dist) {
    for (let i = 0; i < 80; i++) {
      const mx = Math.floor(rng() * size), my = Math.floor(rng() * size);
      if (t[my][mx] !== T_PLAIN) continue;
      let nearSea = false;
      for (let dy = -dist; dy <= dist && !nearSea; dy++) for (let dx = -dist; dx <= dist && !nearSea; dx++) {
        const nx = mx + dx, ny = my + dy;
        if (!inBounds(size, nx, ny)) { nearSea = true; break; }
        if (t[ny][nx] === T_WATER) nearSea = true;
      }
      if (!nearSea) return { x: mx, y: my };
    }
    return null;
  }

  // 贪心放置 nBlocks 个方块(锚点=左上角;要求全陆地非山非水且未占用)
  // [V1.10] blockSize 参数:矿脉 3×3(匹配 3×3 矿场),黏土 5×5(匹配原版黏土坑 5×5)
  function placeBlocks(t, size, candidates, nBlocks, code, used, rng, blockSize) {
    const bs = blockSize || 3;
    // 洗牌
    const pool = candidates.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let placed = 0;
    for (const [ax, ay] of pool) {
      if (placed >= nBlocks) break;
      let ok = true;
      for (let dy = 0; dy < bs && ok; dy++) for (let dx = 0; dx < bs && ok; dx++) {
        const nx = ax + dx, ny = ay + dy;
        if (!inBounds(size, nx, ny)) { ok = false; break; }
        const v = t[ny][nx];
        if (v === T_WATER || v === T_MOUNTAIN || used.has(nx + ',' + ny)) ok = false;
      }
      if (!ok) continue;
      for (let dy = 0; dy < bs; dy++) for (let dx = 0; dx < bs; dx++) {
        t[ay + dy][ax + dx] = code;
        used.add((ax + dx) + ',' + (ay + dy));
      }
      placed++;
    }
    return placed;
  }

  // [B-64] 按 deposits 列表生成矿物(REQ-37:每岛只为入选矿物生成矿床,分级组数)
  // deposits=null 表示全部 7 种(兼容旧 generateMap);黏土 5×5,其余 3×3
  function generateIsland(size, seed, deposits) {
    size = size || 128;
    seed = (seed === undefined || seed === null) ? ((Math.random() * 0xFFFFFFFF) >>> 0) : (seed >>> 0);
    const rng = mulberry32(seed);
    const nEdge = makeNoise(rng);
    const nEco = makeNoise(rng);
    const nMt = makeNoise(rng);

    const t = [];
    for (let y = 0; y < size; y++) t.push(new Array(size).fill(T_WATER));

    // 1. 椭圆基座 + 低频扰动
    const cx = size / 2, cy = size / 2;
    const rx = size * 0.42, ry = size * 0.36;
    const scale = size / 1.6;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        const n = fbm(nEdge, x / scale, y / scale, 3, 2, 0.5);
        if (d < 0.92 + 0.16 * n) t[y][x] = T_PLAIN;
      }
    }

    // 2. 边界强制海洋
    const B = 4;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (x < B || y < B || x >= size - B || y >= size - B) t[y][x] = T_WATER;
    }

    // 3. 单连通陆地
    const landComps = components(t, size, (v) => v !== T_WATER);
    if (landComps.length > 1) {
      const keep = new Set(landComps[0].cells.map(([x, y]) => x + ',' + y));
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (t[y][x] !== T_WATER && !keep.has(x + ',' + y)) t[y][x] = T_WATER;
      }
    }

    // 4. 山脉:双形态随机(A 山脊横穿 / B 岛中央山块),总量封顶 = 陆地 × 15%
    const isLandCell = (x, y) => inBounds(size, x, y) && t[y][x] !== T_WATER;
    const mtCandidates = [];
    if (rng() < 0.5) {
      // A: 2~3 条山脊线(端点取岛内距海岸 ≥8 的点 → 不触岸,两端留通路,不会切断全岛)
      const nRidges = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < nRidges; i++) {
        const p1 = randomInland(rng, t, size, 8);
        const p2 = randomInland(rng, t, size, 8);
        if (!p1 || !p2) continue;
        const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
        const width = 4 + rng() * 2; // 4~6 格宽
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          if (!isLandCell(x, y)) continue;
          const seg = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1) || 1;
          let tt = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / seg;
          tt = Math.max(0, Math.min(1, tt));
          const px = x1 + tt * (x2 - x1), py = y1 + tt * (y2 - y1);
          const d = Math.hypot(x - px, y - py);
          const n = fbm(nMt, x / scale, y / scale, 2, 2, 0.5);
          if (d < width * (0.65 + 0.45 * n)) mtCandidates.push([x, y]);
        }
      }
    } else {
      // B: 1~2 个大圆盘(岛中央)
      const nBlobs = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < nBlobs; i++) {
        const c = randomInland(rng, t, size, 8);
        if (!c) continue;
        const r = 11 + rng() * 8;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          if (!isLandCell(x, y)) continue;
          const d = Math.hypot(x - c.x, y - c.y) / r;
          const n = fbm(nMt, x / scale, y / scale, 2, 2, 0.5);
          if (d < 0.8 + 0.25 * n) mtCandidates.push([x, y]);
        }
      }
    }
    {
      // 洗牌取前 15% 陆地(精确控量,避免山脊切断全岛)
      for (let i = mtCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [mtCandidates[i], mtCandidates[j]] = [mtCandidates[j], mtCandidates[i]];
      }
      let landCount = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (t[y][x] === T_PLAIN) landCount++;
      const target = Math.floor(landCount * 0.15);
      const take = Math.min(target, mtCandidates.length);
      for (let i = 0; i < take; i++) {
        const [mx, my] = mtCandidates[i];
        t[my][mx] = T_MOUNTAIN;
      }
    }
    // 清除孤立单格山
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      if (t[y][x] !== T_MOUNTAIN) continue;
      const adj = DIRS4.some(([dx, dy]) => t[y + dy][x + dx] === T_MOUNTAIN);
      if (!adj) t[y][x] = T_PLAIN;
    }

    // 5. 矿脉贴山:3×3 矿床块(块内任意格 4 邻山即"贴山"),按到山体中心距离分层(近铁/中铜/远金)
    const mtComps = components(t, size, (v) => v === T_MOUNTAIN);
    const largest = mtComps[0];
    const lc = largest.cells[0];
    // 收集所有可行 3×3 块(全陆地非山非水未占用 ∧ 块内某格 4 邻山)
    const oreCandidates = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let ok = true, touchesMt = false;
      let maxDist = 0;
      for (let dy = 0; dy < 3 && ok; dy++) for (let dx = 0; dx < 3 && ok; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(size, nx, ny)) { ok = false; break; }
        const v = t[ny][nx];
        if (v === T_WATER || v === T_MOUNTAIN) { ok = false; break; }
        if (DIRS4.some(([ddx, ddy]) => {
          const wx = nx + ddx, wy = ny + ddy;
          return inBounds(size, wx, wy) && t[wy][wx] === T_MOUNTAIN;
        })) touchesMt = true;
        const d = Math.hypot(nx - lc[0], ny - lc[1]);
        if (d > maxDist) maxDist = d;
      }
      if (ok && touchesMt) oreCandidates.push([x, y, maxDist]);
    }
    oreCandidates.sort((a, b) => b[2] - a[2]); // 距离降序(远=金)
    const nOre = oreCandidates.length;
    const far = [], mid = [], near = [];
    for (let i = 0; i < nOre; i++) {
      const f = nOre > 3 ? i / nOre : 1;
      if (f < 0.25) far.push([oreCandidates[i][0], oreCandidates[i][1]]);
      else if (f < 0.55) mid.push([oreCandidates[i][0], oreCandidates[i][1]]);
      else near.push([oreCandidates[i][0], oreCandidates[i][1]]);
    }
    const used = new Set();
    const want = (m) => !deposits || deposits.indexOf(m) >= 0;
    // [Sol 轮3] 记录每种矿物本次抽定的目标组数(AC-20:校验须达到抽定值而非仅 min)
    const drawn = {};
    if (want('gold')) {
      const goldBlocks = 1 + Math.floor(rng() * 2); // 1~2 块(REQ-37 分级)
      drawn.gold = goldBlocks;
      placeBlocks(t, size, far, goldBlocks, T_GOLD, used, rng);
    }
    if (want('copper')) {
      const copperBlocks = 3 + Math.floor(rng() * 2); // 3~4 块
      drawn.copper = copperBlocks;
      placeBlocks(t, size, mid, copperBlocks, T_COPPER, used, rng);
    }
    if (want('iron')) {
      const ironBlocks = 5 + Math.floor(rng() * 2); // 5~6 块
      drawn.iron = ironBlocks;
      placeBlocks(t, size, near.concat(far, mid), ironBlocks, T_IRON, used, rng);
    }
    // [修订⑤ 顺序8] 煤矿/锌矿/石灰岩矿:贴山缘 3×3
    if (want('coal')) {
      const coalBlocks = 4 + Math.floor(rng() * 2); // 4~5 块
      drawn.coal = coalBlocks;
      placeBlocks(t, size, near.concat(far, mid), coalBlocks, T_COAL, used, rng);
    }
    if (want('zinc')) {
      const zincBlocks = 2 + Math.floor(rng() * 2); // 2~3 块
      drawn.zinc = zincBlocks;
      placeBlocks(t, size, near.concat(far, mid), zincBlocks, T_ZINC, used, rng);
    }
    if (want('limestone')) {
      const limestoneBlocks = 2 + Math.floor(rng() * 2); // 2~3 块
      drawn.limestone = limestoneBlocks;
      placeBlocks(t, size, near.concat(far, mid), limestoneBlocks, T_LIMESTONE, used, rng);
    }

    // 6. 黏土 5×5 块:海岸带(块内至少一格邻水),不贴山(8 邻无山);[V1.10] 5×5 匹配原版黏土坑
    {
      const BS = 5;
      const candidates = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (t[y][x] !== T_PLAIN || used.has(x + ',' + y)) continue;
        // BS×BS 全陆地非山
        let ok = true, touchesWater = false, touchesMountain = false;
        for (let dy = 0; dy < BS && ok; dy++) for (let dx = 0; dx < BS && ok; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(size, nx, ny)) { ok = false; break; }
          const v = t[ny][nx];
          if (v === T_WATER || v === T_MOUNTAIN || used.has(nx + ',' + ny)) { ok = false; break; }
          if (DIRS4.some(([ddx, ddy]) => {
            const wx = nx + ddx, wy = ny + ddy;
            return inBounds(size, wx, wy) && t[wy][wx] === T_WATER;
          })) touchesWater = true;
          if (DIRS8.some(([ddx, ddy]) => {
            const mx2 = nx + ddx, my2 = ny + ddy;
            return inBounds(size, mx2, my2) && t[my2][mx2] === T_MOUNTAIN;
          })) touchesMountain = true;
        }
        if (ok && touchesWater && !touchesMountain) candidates.push([x, y]);
      }
      if (!deposits || deposits.indexOf('clay') >= 0) {
        const clayBlocks = 3 + Math.floor(rng() * 2); // 3~4 块 × 25 格(REQ-37 分级)
        drawn.clay = clayBlocks;
        placeBlocks(t, size, candidates, clayBlocks, T_CLAY, used, rng, BS);
      }
    }

    // 7. [用户决策] 生态带森林已移除(森林地形与机制全部下线,地形码 1 不再生成)

    // 8. 最终保证:以山脉为障碍的可通行陆地单连通(隔离区填海)
    const passComps = components(t, size, (v) => v !== T_WATER && v !== T_MOUNTAIN);
    if (passComps.length > 1) {
      const keep = new Set(passComps[0].cells.map(([x, y]) => x + ',' + y));
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const v = t[y][x];
        if (v === T_WATER || v === T_MOUNTAIN) continue;
        if (!keep.has(x + ',' + y)) t[y][x] = T_WATER;
      }
    }

    // [Sol 轮3] 暴露本次抽定组数(挂数组属性,兼容 Array.isArray 调用方;JSON 序列化不保留,存档无此字段)
    t.drawnGroups = drawn;
    return t;
  }

  // 兼容入口:全部 7 种矿物(旧行为;新游戏主岛由 state.js 传 MAIN_DEPOSITS)
  function generateMap(size, seed) {
    return generateIsland(size, seed, null);
  }

  const api = { generateMap, generateIsland };
  root.Engine = root.Engine || {};
  root.Engine.mapTemplate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
