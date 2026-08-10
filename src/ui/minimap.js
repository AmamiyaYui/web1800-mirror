/* minimap.js — 小地图:地形离屏缓存 + 建筑/相机框叠加 + 点击跳转 [V1.8] */
(function (root) {
  'use strict';
  const W = 128, H = 128; // 小地图像素(256 格 → 0.5px/格)
  let cache = null; // { size, canvas } 地形层缓存(地图尺寸变化时重建)

  function ensureCache(state) {
    if (cache && cache.size === state.map.size && cache.mapRef === state.map) return cache;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const colors = root.Render.mapRenderer.TERRAIN_COLORS;
    const size = state.map.size;
    const sx = W / size, sy = H / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = colors[state.map.terrain[y][x]] || '#ccc';
        ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.max(1, Math.floor(sx + 0.5)), Math.max(1, Math.floor(sy + 0.5)));
      }
    }
    cache = { size: state.map.size, mapRef: state.map, canvas: c };
    return cache;
  }

  function draw(el, state, cam, tile, vw, vh) {
    const base = ensureCache(state);
    const ctx = el.getContext('2d');
    el.width = W; el.height = H;
    ctx.drawImage(base.canvas, 0, 0);

    const size = state.map.size;
    const sx = W / size, sy = H / size;
    // 建筑点
    ctx.fillStyle = '#f9a825';
    for (const b of Object.values(state.buildings)) {
      ctx.fillRect(Math.floor(b.x * sx), Math.floor(b.y * sy), Math.max(1, Math.ceil(sx)), Math.max(1, Math.ceil(sy)));
    }
    // 相机可视框
    const wx0 = cam.x / tile, wy0 = cam.y / tile;
    const wx1 = (cam.x + vw) / tile, wy1 = (cam.y + vh) / tile;
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(wx0 * sx, wy0 * sy, (wx1 - wx0) * sx, (wy1 - wy0) * sy);
  }

  function bind(el, renderer, getState) {
    // 点击小地图 → 视野中心跳转到对应世界位置
    el.addEventListener('click', (e) => {
      const rect = el.getBoundingClientRect();
      const wx = (e.clientX - rect.left) / rect.width;
      const wy = (e.clientY - rect.top) / rect.height;
      const state = getState();
      const worldX = wx * state.map.size * renderer.getTile();
      const worldY = wy * state.map.size * renderer.getTile();
      renderer.setCamera(worldX - window.innerWidth / 2, worldY - window.innerHeight / 2);
    });
  }

  root.UI = root.UI || {};
  root.UI.minimap = { draw, bind };
})(typeof globalThis !== 'undefined' ? globalThis : this);
