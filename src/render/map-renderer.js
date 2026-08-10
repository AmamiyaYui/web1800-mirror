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
    let zoom = 1;           // [V1.10 修订⑤ 顺序18] 滚轮缩放因子(0.5-4)
    const MIN_ZOOM = 0.5, MAX_ZOOM = 4;
    let hover = null;
    let preview = null; // { type, x, y, ok } [V1.1] 放置预览
    let radius = null;  // { x, y, r } [V1.1] 服务范围
    let floaters = [];  // [V1.2] 产出飘字

    // 瓦片尺寸:地图较小时放大填充视口(fitted),但下限 32px——
    // 地图超过视口时保持 32px 溢出,平移视野生效(为后续大地图铺垫)
    function computeTile(vw, vh) {
      const size = getState().map.size;
      const fitted = Math.floor((Math.min(vw, vh) - 24) / size);
      return Math.max(32, Math.min(64, fitted));
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

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      // [V1.8] 视口裁剪:只绘制相机可见瓦片(256×256 全图绘制不可行)
      const x0 = Math.max(0, Math.floor(cam.x / tile));
      const y0 = Math.max(0, Math.floor(cam.y / tile));
      const x1 = Math.min(size - 1, Math.ceil((cam.x + vw) / tile));
      const y1 = Math.min(size - 1, Math.ceil((cam.y + vh) / tile));

      // 地形(世界坐标,仅可见范围)[性能 B:网格线仅放大时画,减少一半绘制调用]
      const drawGrid = zoom >= 1.5;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = s.map.terrain[y][x];
          ctx.fillStyle = TERRAIN_COLORS[t] || '#ccc';
          ctx.fillRect(x * tile, y * tile, tile, tile);
          if (drawGrid) {
            ctx.strokeStyle = 'rgba(0,0,0,0.08)';
            ctx.strokeRect(x * tile + 0.5, y * tile + 0.5, tile, tile);
          }
        }
      }
      // 道路(仅可见范围)
      const roadIn = tile * 0.2, roadSz = tile * 0.6;
      for (const k of Object.keys(s.roads)) {
        const [x, y] = k.split(',').map(Number);
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        // [V1.10 修订⑤ 顺序3/13] 道路等级:土路土黄 / 石板路浅灰(服务传播 1.5 倍,土路升级而来)
        ctx.fillStyle = s.roads[k] === 2 ? '#c9c9c9' : '#b5895a';
        ctx.fillRect(x * tile + roadIn, y * tile + roadIn, roadSz, roadSz);
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
        ctx.fillStyle = BUILDING_COLORS[colorKey];
        ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
        ctx.fillStyle = '#fff';
        // [玩家反馈] 显示全名:字号按建筑宽度自适应(放不下时最小 9px,仍溢出则截断)
        const nameFont2 = Math.min((pw - 4) / def.name.length, nameFont);
        ctx.font = 'bold ' + Math.max(9, Math.round(nameFont2)) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(def.name, px + pw / 2, py + ph / 2);
        if (b.status === 'disconnected') {
          ctx.fillStyle = '#d32f2f';
          ctx.font = 'bold ' + (nameFont + 3) + 'px sans-serif';
          ctx.fillText('⚠', px + pw - tile * 0.15, py + tile * 0.35);
        } else if (b.status === 'waiting') {
          ctx.fillStyle = '#f57f17';
          ctx.font = 'bold ' + nameFont + 'px sans-serif';
          ctx.fillText('!', px + pw - tile * 0.15, py + tile * 0.35);
        }
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
          ctx.fillStyle = 'rgba(92,107,192,0.25)';
          for (const k of covered) {
            const [rx, ry] = k.split(',').map(Number);
            ctx.fillRect(rx * tile, ry * tile, tile, tile);
          }
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
      // [V1.2] 产出飘字(1.2s 上升淡出,世界坐标)
      const now = performance.now();
      floaters = floaters.filter((f) => now - f.born < 1200);
      for (const f of floaters) {
        const age = (now - f.born) / 1200;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.fillStyle = f.color;
        ctx.font = 'bold ' + nameFont + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.text, (f.x + 0.5) * tile, (f.y + 0.3) * tile - age * tile * 0.8);
        ctx.globalAlpha = 1;
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
      clampCamera(canvas.width, canvas.height);
    }

    // [V1.10 修订⑧] 首屏定位到最接近岛屿平地重心的可建格，而不是地图左上角海面。
    function focusInitialArea() {
      const s = getState();
      const parent = canvas.parentElement;
      const vw = parent ? parent.clientWidth : window.innerWidth;
      const vh = parent ? parent.clientHeight : window.innerHeight;
      tile = computeTile(vw, vh) * zoom;

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
    function zoomAt(factor, clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const before = tileAt(clientX, clientY);
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      const vw = canvas.width, vh = canvas.height;
      const nt = computeTile(vw, vh) * zoom;
      cam.x = before.x * nt + nt / 2 - (clientX - rect.left);
      cam.y = before.y * nt + nt / 2 - (clientY - rect.top);
      clampCamera(vw, vh);
    }
    function getCamera() { return { x: cam.x, y: cam.y }; }

    function setHover(t) { hover = t; }
    function setPreview(p) { preview = p; }
    function getPreview() { return preview; } // [V1.10 修订⑤ 顺序11] R 键旋转时刷新预览
    function setRadius(r) { radius = r; }
    function addFloater(x, y, text, color) { // [V1.2]
      floaters.push({ x, y, text, color: color || '#ffd54f', born: performance.now() });
      if (floaters.length > 30) floaters.shift();
    }

    return { draw, tileAt, setHover, setPreview, getPreview, setRadius, addFloater, setCamera, getCamera, focusInitialArea, zoomAt, getZoom: () => zoom, getTile: () => tile };
  }

  root.Render = root.Render || {};
  root.Render.mapRenderer = { createRenderer, TERRAIN_COLORS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
