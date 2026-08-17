/* map-renderer.js — Canvas 网格渲染(地形/道路/建筑/⚠️/悬停)
 * [V1.5] 相机系统:地图为全窗背景,支持平移(边界钳制,小于视口自动居中)
 */
(function (root) {
  'use strict';
  const TERRAIN_COLORS = {
    0: '#2e7d32', // 平地(承接森林旧色,用户决策森林移除)
    1: '#2e7d32', // 森林旧地形码(不再生成,兼容旧档渲染)
    2: '#a1887f', // 黏土
    3: '#78909c', // 铁矿
    4: '#d84315', // 铜矿
    5: '#ffd54f', // 金矿
    6: '#1976d2', // 水域
    7: '#5c6b7a', // [V1.8] 山脉
    8: '#37474f', // [顺序8] 煤矿(深灰黑)
    9: '#c0ca33', // [顺序8] 锌矿(黄绿)
    10: '#bcaaa4', // [顺序8] 石灰岩矿(浅棕灰)
  };
  const BUILDING_COLORS = {
    warehouse: '#f9a825',
    residence: '#8d6e63',
    production: '#26a69a',
    service: '#5c6bc0',
  };

  function createRenderer(canvas, getState) {
    const ctx = canvas.getContext('2d');
    let tile = 30;          // 动态瓦片尺寸(随窗口等比缩放 × 滚轮缩放因子)
    let cam = { x: 0, y: 0 }; // [V1.5] 相机偏移(世界像素 → 屏幕: sx = wx - cam)
    let zoom = 1;           // [V1.10 修订⑤ 顺序18] 滚轮缩放因子
    // [B-67] 缩放下限动态(地图贴满视口短边,见 zoomAt);上限 4 倍
    const MAX_ZOOM = 4;
    let miniCache = null;   // [B-67] 全图级别离屏缩略缓存(布局版本变化才重建,每帧 drawImage)
    let miniVer = -1;
    let miniIsland = null;  // [紧急修复] 缓存所属岛(切岛后必须重建,否则旧岛缩略图叠在新岛渲染上)
    let coverRects = null;  // [修复] 服务覆盖矩形缓存(格坐标;radius 键+布局版本变化才重建,每帧只 fillRect)
    let coverKey = '';
    // [根治] 分层渲染:静态层(背景+地形+道路+建筑)离屏缓存,预览拖动/悬停时每帧只画动态层(预览/覆盖/hover)
    // 静态层在相机/布局/状态变化时重建(tick 后一次),拖动中不复用重绘 → 大档放大级别拖动流畅
    let staticLayer = null;
    let staticDirty = true;
    let lastLayoutVer = null;
    function markStaticDirty() { staticDirty = true; }
    let hover = null;
    let preview = null; // { type, x, y, ok } [V1.1] 放置预览
    let radius = null;  // { x, y, r } [V1.1] 服务范围

    // 瓦片尺寸:地图较小时放大填充视口(fitted);[B-67] 不再钳制 32px 下限——
    // 160 地图可缩到全图可见(视口适配),海岸线/岛屿整体一览,铺海岸建筑无需盲平移
    function computeTile(vw, vh) {
      const size = getState().map.size;
      const fitted = Math.floor((Math.min(vw, vh) - 24) / size);
      return Math.max(1, Math.min(64, fitted));
    }

    // [V1.5] 相机边界钳制:地图小于视口 → 居中;大于视口 → 限制在 [0, 地图-视口]
    function clampCamera(vw, vh) {
      const size = getState().map.size;
      const mw = size * tile, mh = size * tile;
      if (mw <= vw) cam.x = (mw - vw) / 2;
      else cam.x = Math.max(0, Math.min(mw - vw, cam.x));
      if (mh <= vh) cam.y = (mh - vh) / 2;
      else cam.y = Math.max(0, Math.min(mh - vh, cam.y));
    }

    // [根治] 静态层重建:背景+地形+道路+建筑绘制到离屏 canvas(世界坐标),draw 时按相机 drawImage
    // 相机/布局(_layoutVer)/状态(redraw→markStaticDirty)变化才重建;预览拖动中复用 → 每帧只画动态层
    function rebuildStaticLayer(s, size, vw, vh) {
      if (!staticLayer) staticLayer = document.createElement('canvas');
      if (staticLayer.width !== vw) staticLayer.width = vw;
      if (staticLayer.height !== vh) staticLayer.height = vh;
      const sc = staticLayer.getContext('2d');
      sc.clearRect(0, 0, vw, vh);
      sc.fillStyle = '#14213d';
      sc.fillRect(0, 0, vw, vh);
      sc.save();
      sc.translate(-cam.x, -cam.y);
      const simple = false; // [根治] 静态层恒非 simple(名称绘制不受缩放级别限制)
      const x0 = Math.max(0, Math.floor(cam.x / tile));
      const y0 = Math.max(0, Math.floor(cam.y / tile));
      const x1 = Math.min(size - 1, Math.ceil((cam.x + vw) / tile));
      const y1 = Math.min(size - 1, Math.ceil((cam.y + vh) / tile));
        // 地形(世界坐标,仅可见范围)[性能 B:网格线仅放大时画,减少一半绘制调用]
        const drawGrid = zoom >= 1.5;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const t = s.map.terrain[y][x];
            sc.fillStyle = TERRAIN_COLORS[t] || '#ccc';
            sc.fillRect(x * tile, y * tile, tile, tile);
            if (drawGrid) {
              sc.strokeStyle = 'rgba(0,0,0,0.08)';
              sc.strokeRect(x * tile + 0.5, y * tile + 0.5, tile, tile);
            }
          }
        }
        // 道路(仅可见范围)
        const roadIn = tile * 0.2, roadSz = tile * 0.6;
        for (const k of Object.keys(s.roads)) {
          const [x, y] = k.split(',').map(Number);
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          // [V1.10 修订⑤ 顺序3/13] 道路等级:土路土黄 / 石板路浅灰(服务传播 1.5 倍,土路升级而来)
          sc.fillStyle = s.roads[k] === 2 ? '#c9c9c9' : '#b5895a';
          sc.fillRect(x * tile + roadIn, y * tile + roadIn, roadSz, roadSz);
        }
        // 建筑(仅可见范围)[V1.8 修订②:多格 footprint]
        const nameFont = Math.max(10, Math.round(tile * 0.45));
        for (const b of Object.values(s.buildings)) {
          if (b.x > x1 || b.y > y1) continue;
          const def = Engine.buildings.getDef(b.type);
          if (!def) continue;
          // [V1.10 修订⑤ 顺序11] 建筑朝向:绕锚点旋转,绘制用旋转后包围盒(锚点可能不在左上角)
          const rs = Engine.placement.footprintBounds(def, b.x, b.y, b.rot);
          const w = rs.w, h = rs.h;
          if (rs.x + w - 1 < x0 || rs.y + h - 1 < y0) continue;
          const px = rs.x * tile, py = rs.y * tile;
          const pw = w * tile, ph = h * tile;
          const colorKey = def.special === 'warehouse' ? 'warehouse'
            : (def.category === '住宅' ? 'residence' : (def.category === '服务' ? 'service' : 'production'));
          sc.fillStyle = BUILDING_COLORS[colorKey];
          sc.fillRect(px + 1, py + 1, pw - 2, ph - 2);
          sc.strokeStyle = 'rgba(0,0,0,0.35)';
          sc.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
          if (simple) continue;
          sc.fillStyle = '#fff';
          // [玩家反馈] 显示全名:字号按建筑宽度自适应(放不下时最小 9px,仍溢出则截断)
          const nameFont2 = Math.min((pw - 4) / def.name.length, nameFont);
          sc.font = 'bold ' + Math.max(9, Math.round(nameFont2)) + 'px sans-serif';
          sc.textAlign = 'center';
          sc.textBaseline = 'middle';
          sc.fillText(def.name, px + pw / 2, py + ph / 2);
          if (b.status === 'disconnected') {
            sc.fillStyle = '#d32f2f';
            sc.font = 'bold ' + (nameFont + 3) + 'px sans-serif';
            sc.fillText('⚠', px + pw - tile * 0.15, py + tile * 0.35);
          } else if (b.status === 'waiting') {
            sc.fillStyle = '#f57f17';
            sc.font = 'bold ' + nameFont + 'px sans-serif';
            sc.fillText('!', px + pw - tile * 0.15, py + tile * 0.35);
          }
        }

      sc.restore();
    }

    function draw() {
      const s = getState();
      const size = s.map.size;
      const parent = canvas.parentElement;
      const vw = parent ? parent.clientWidth : window.innerWidth;
      const vh = parent ? parent.clientHeight : window.innerHeight;
      // [性能 A] canvas 尺寸仅变化时重设(重设=清空画布+重置上下文,是最贵操作)
      if (canvas.width !== vw) canvas.width = vw;
      if (canvas.height !== vh) canvas.height = vh;
      tile = computeTile(vw, vh) * zoom;
      clampCamera(vw, vh);
      // [修复] 动态层(preview 名称字号)的 nameFont——rebuildStaticLayer 内有同名局部变量,作用域独立
      const nameFont = Math.max(10, Math.round(tile * 0.45));
      // [紧急修复] canvas 不自动擦除:显式清画布 + 深水背景(相机移动/缩小后旧帧残影必须清除)
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#14213d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      // [V1.8] 视口裁剪:只绘制相机可见瓦片(256×256 全图绘制不可行)
      const x0 = Math.max(0, Math.floor(cam.x / tile));
      const y0 = Math.max(0, Math.floor(cam.y / tile));
      const x1 = Math.min(size - 1, Math.ceil((cam.x + vw) / tile));
      const y1 = Math.min(size - 1, Math.ceil((cam.y + vh) / tile));

      // [B-67] 简化绘制:全图缩小级别(tile<12px)走离屏缩略缓存(布局版本变化才重建,每帧 drawImage)
      const simple = tile < 12;
      if (simple) {
        if (!miniCache || miniIsland !== s.activeIslandId || miniVer !== (s._layoutVer || 0)) {
          if (!miniCache) { miniCache = document.createElement('canvas'); miniCache.width = size; miniCache.height = size; }
          const mc = miniCache.getContext('2d');
          mc.clearRect(0, 0, size, size);
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            mc.fillStyle = TERRAIN_COLORS[s.map.terrain[y][x]] || '#ccc';
            mc.fillRect(x, y, 1, 1);
          }
          for (const k of Object.keys(s.roads)) {
            const [x, y] = k.split(',').map(Number);
            mc.fillStyle = s.roads[k] === 2 ? '#c9c9c9' : '#b5895a';
            mc.fillRect(x, y, 1, 1);
          }
          for (const b of Object.values(s.buildings)) {
            const def = Engine.buildings.getDef(b.type);
            if (!def) continue;
            const rs = Engine.placement.footprintBounds(def, b.x, b.y, b.rot);
            const colorKey = def.special === 'warehouse' ? 'warehouse'
              : (def.category === '住宅' ? 'residence' : (def.category === '服务' ? 'service' : 'production'));
            mc.fillStyle = BUILDING_COLORS[colorKey];
            mc.fillRect(rs.x, rs.y, rs.w, rs.h);
          }
          miniIsland = s.activeIslandId;
          miniVer = s._layoutVer || 0;
        }
        ctx.drawImage(miniCache, 0, 0, size, size, 0, 0, size * tile, size * tile);
      } else {
        // [根治] 静态层:背景+地形+道路+建筑离屏缓存(相机/布局/状态变化才重建;预览拖动中每帧只 drawImage)
        if (staticDirty || !staticLayer || staticLayer.width !== vw || staticLayer.height !== vh || lastLayoutVer !== (s._layoutVer || 0)) {
          rebuildStaticLayer(s, size, vw, vh);
          lastLayoutVer = s._layoutVer || 0;
          staticDirty = false;
        }
        ctx.drawImage(staticLayer, 0, 0, vw, vh, cam.x, cam.y, vw, vh); // [根治] 屏幕坐标缓存 → 世界坐标绘制(translate 下)
      }
      // [V1.10 修订] 服务范围 = 路距离:沿道路延伸覆盖(原版机制),悬停/预览服务建筑时显示
      // [用户要求] 开发度范围可视化:农田/牧场/伐木类(production.radius)显示未开发范围圆 + 开发度%
      if (radius && radius.type) {
        const cx = (radius.x + 0.5) * tile, cy = (radius.y + 0.5) * tile, rr = radius.r * tile;
        if (radius.type === 'dev') {
          ctx.strokeStyle = 'rgba(255,167,38,0.9)';
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          if (radius.dev != null) {
            const open = Math.round((1 - radius.dev) * 100); // [用户要求] 可开发% = 未占用地块占比
            ctx.fillStyle = open > 75 ? '#43a047' : (open > 50 ? '#ffb74d' : (open > 25 ? '#f57f17' : '#d32f2f'));
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('可开发 ' + open + '%', cx, cy - rr - 14);
          }
        } else {
          const covered = root.Engine.population.serviceRoads(getState(), radius.type);
          // [修复] 覆盖矩形缓存:Set→rects(格坐标,行合并)只在 radius 键+布局版本变化时重建;
          // 每帧只 fillRect(缩放/平移不重建,tile 换算在绘制时);键含岛标识与 radius.r(切岛/半径变化必须失效)
          const key = s.activeIslandId + '|' + radius.type + ':' + radius.x + ',' + radius.y + ':' + (radius.r || 0) + ':' + (s._layoutVer || 0);
          if (coverRects === null || coverKey !== key) {
            coverKey = key;
            const rows = new Map();
            for (const k of covered) {
              const c = k.indexOf(',');
              const rx = Number(k.slice(0, c)), ry = Number(k.slice(c + 1));
              let xs = rows.get(ry);
              if (!xs) { xs = []; rows.set(ry, xs); }
              xs.push(rx);
            }
            const rects = [];
            for (const [ry, xs] of rows) {
              xs.sort((a, b) => a - b);
              let s2 = xs[0], prev = xs[0];
              for (let i = 1; i <= xs.length; i++) {
                const x = xs[i];
                if (x === prev + 1) { prev = x; continue; }
                rects.push([s2, ry, prev - s2 + 1]);
                if (i < xs.length) { s2 = x; prev = x; }
              }
            }
            coverRects = rects;
          }
          ctx.fillStyle = 'rgba(92,107,192,0.25)';
          for (const [rx, ry, w] of coverRects) ctx.fillRect(rx * tile, ry * tile, w * tile, tile);
          ctx.strokeStyle = 'rgba(92,107,192,0.8)';
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      // 放置预览[V1.8 修订②:多格 footprint][V1.10 修订⑤ 顺序11/17:按 rot 逐格显示 footprint + 锚点标记]
      if (preview) {
        const pdef = Engine.buildings.getDef(preview.type);
        const cells = pdef ? Engine.placement.footprint(pdef, preview.x, preview.y, preview.rot) : [{ x: preview.x, y: preview.y }];
        ctx.fillStyle = preview.ok ? 'rgba(76,175,80,0.5)' : 'rgba(211,47,47,0.5)';
        for (const c of cells) ctx.fillRect(c.x * tile + 1, c.y * tile + 1, tile - 2, tile - 2);
        // 锚点格白框+十字标记(放置参考点;点击绿块内任意格均按锚点放置)
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(preview.x * tile + 1, preview.y * tile + 1, tile - 2, tile - 2);
        ctx.beginPath();
        ctx.moveTo((preview.x + 0.5) * tile, preview.y * tile + 2);
        ctx.lineTo((preview.x + 0.5) * tile, (preview.y + 1) * tile - 2);
        ctx.moveTo(preview.x * tile + 2, (preview.y + 0.5) * tile);
        ctx.lineTo((preview.x + 1) * tile - 2, (preview.y + 0.5) * tile);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = preview.ok ? '#4caf50' : '#d32f2f';
        ctx.lineWidth = 2;
        ctx.strokeRect(preview.x * tile + 1.5, preview.y * tile + 1.5, tile - 3, tile - 3);
        ctx.lineWidth = 1;
        if (pdef) {
          const bb = Engine.placement.footprintBounds(pdef, preview.x, preview.y, preview.rot);
          ctx.fillStyle = '#fff';
          // [玩家反馈] 预览同样显示全名
          const pfs = Math.min((bb.w * tile - 4) / pdef.name.length, nameFont);
          ctx.font = 'bold ' + Math.max(9, Math.round(pfs)) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pdef.name, (bb.x + bb.w / 2) * tile, (bb.y + bb.h / 2) * tile);
        }
      }
      // 悬停高亮
      if (hover) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(hover.x * tile + 1, hover.y * tile + 1, tile - 2, tile - 2);
        ctx.lineWidth = 1;
      }
      ctx.restore();

      // [V1.6] 昼夜明暗(屏幕空间遮罩):7-17 白天,18-21 黄昏渐暗,22-4 深夜,5-6 清晨渐亮
      const h = s.time.hour;
      let alpha = 0;
      if (h >= 18 && h < 22) alpha = 0.45 * (h - 17) / 5;
      else if (h < 5) alpha = 0.45;
      else if (h < 7) alpha = 0.45 * (7 - h) / 2;
      if (alpha > 0) {
        ctx.fillStyle = 'rgba(8, 12, 30, ' + alpha.toFixed(3) + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    // [V1.5] 屏幕坐标 → 世界瓦片坐标(相机补偿 + 网格钳制)
    function tileAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const size = getState().map.size;
      let x = Math.floor((clientX - rect.left + cam.x) / tile);
      let y = Math.floor((clientY - rect.top + cam.y) / tile);
      x = Math.max(0, Math.min(size - 1, x));
      y = Math.max(0, Math.min(size - 1, y));
      return { x, y };
    }

    function setCamera(x, y) {
      cam.x = x;
      cam.y = y;
      markStaticDirty(); // [根治] 相机移动 → 静态层重建
      clampCamera(canvas.width, canvas.height);
    }

    // [V1.10 修订⑧] 首屏定位到最接近岛屿平地重心的可建格，而不是地图左上角海面。
    // [B-67] 初始视野 = 全图贴边(地图充满视口短边,无留白;不再缩到比地图小)
    function focusInitialArea() {
      const s = getState();
      const parent = canvas.parentElement;
      const vw = parent ? parent.clientWidth : window.innerWidth;
      const vh = parent ? parent.clientHeight : window.innerHeight;
      const base = computeTile(vw, vh);
      zoom = Math.max(0.1, (Math.min(vw, vh) - 24) / (s.map.size * base));
      tile = base * zoom;
      markStaticDirty(); // [根治] 初始定位 → 静态层重建

      let sumX = 0, sumY = 0, count = 0;
      for (let y = 0; y < s.map.size; y++) {
        for (let x = 0; x < s.map.size; x++) {
          if (s.map.terrain[y][x] !== 0) continue;
          sumX += x;
          sumY += y;
          count++;
        }
      }

      let target = { x: Math.floor(s.map.size / 2), y: Math.floor(s.map.size / 2) };
      if (count > 0) {
        const cx = sumX / count, cy = sumY / count;
        let bestDist = Infinity;
        for (let y = 0; y < s.map.size; y++) {
          for (let x = 0; x < s.map.size; x++) {
            if (s.map.terrain[y][x] !== 0) continue;
            const dist = (x - cx) ** 2 + (y - cy) ** 2;
            if (dist < bestDist) {
              bestDist = dist;
              target = { x, y };
            }
          }
        }
      }

      cam.x = (target.x + 0.5) * tile - vw / 2;
      cam.y = (target.y + 0.5) * tile - vh / 2;
      clampCamera(vw, vh);
      return target;
    }

    // [V1.10 修订⑤ 顺序18] 滚轮缩放:以鼠标位置为焦点(鼠标下的格保持不动)
    // [B-67] 最小缩放 = 地图恰好充满视口短边(贴边),不再缩到比地图小留白
    function zoomAt(factor, clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const before = tileAt(clientX, clientY);
      const vw = canvas.width, vh = canvas.height;
      const size = getState().map.size;
      const base = computeTile(vw, vh);
      const minZoom = Math.max(0.1, (Math.min(vw, vh) - 24) / (size * base));
      zoom = Math.min(MAX_ZOOM, Math.max(minZoom, zoom * factor));
      markStaticDirty(); // [根治] 缩放 → 静态层重建
      const nt = base * zoom;
      cam.x = before.x * nt + nt / 2 - (clientX - rect.left);
      cam.y = before.y * nt + nt / 2 - (clientY - rect.top);
      clampCamera(vw, vh);
    }
    function getCamera() { return { x: cam.x, y: cam.y }; }

    function setHover(t) { hover = t; }
    function setPreview(p) { preview = p; }
    function getPreview() { return preview; } // [V1.10 修订⑤ 顺序11] R 键旋转时刷新预览
    function setRadius(r) { radius = r; }

    return { draw, tileAt, setHover, setPreview, getPreview, setRadius, setCamera, getCamera, focusInitialArea, zoomAt, getZoom: () => zoom, getTile: () => tile, getTileSize: () => tile, markStaticDirty }; // [根治] markStaticDirty:状态变化后静态层重建
  }

  root.Render = root.Render || {};
  root.Render.mapRenderer = { createRenderer, TERRAIN_COLORS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
