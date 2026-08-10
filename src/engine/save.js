/* save.js — 存档:JSON schema 版本化,损坏备份+重置 */
(function (root) {
  'use strict';

  const SAVE_KEY = 'web1800-save-v1';
  const BAK_KEY = 'web1800-save-v1.bak';

  function serialize(state) {
    return JSON.stringify({ v: 1, ts: Date.now(), state });
  }

  // [P0/HIGH] ratesHistory 统一归一化(load 与 tick 运行时共用):
  // 顶层非普通对象 → 空对象;资源窗口要求 p/c/n 均为有限数值数组、三轨等长、≤60;
  // 不信任保存的 sp/sc/sn,按数组重算;重算结果须有限(有限元素求和仍可溢出 → 丢弃窗口);
  // __pop 单独验证 {n,sn}(n 为有限数值数组,sn 重算后同样须有限)
  function normalizeRatesHistory(rh) {
    if (!rh || typeof rh !== 'object' || Array.isArray(rh)) return {};
    const out = {};
    const isFiniteArr = (a) => Array.isArray(a) && a.every((v) => typeof v === 'number' && Number.isFinite(v));
    const sumFinite = (a) => {
      let s = 0;
      for (const v of a) s += v;
      return Number.isFinite(s) ? s : null; // 有限元素求和仍可能溢出(60×1e308 → Infinity)
    };
    for (const [g, h] of Object.entries(rh)) {
      if (g === '__pop') {
        if (!h || typeof h !== 'object' || !isFiniteArr(h.n)) continue;
        const n = h.n.slice(-60);
        const sn = sumFinite(n);
        if (sn === null) continue; // 溢出 → 丢弃窗口
        out[g] = { n, sn };
        continue;
      }
      if (!h || typeof h !== 'object' || !isFiniteArr(h.p) || !isFiniteArr(h.c) || !isFiniteArr(h.n)) continue;
      const L = Math.min(60, h.p.length, h.c.length, h.n.length);
      if (L <= 0) { out[g] = { p: [], c: [], n: [], sp: 0, sc: 0, sn: 0 }; continue; }
      const p = h.p.slice(-L), c = h.c.slice(-L), n = h.n.slice(-L);
      const sp = sumFinite(p), sc = sumFinite(c), sn = sumFinite(n);
      if (sp === null || sc === null || sn === null) continue; // 任一轨道溢出 → 丢弃整窗口
      out[g] = { p, c, n, sp, sc, sn };
    }
    return out;
  }

  // 抛错 = 存档非法
  function deserialize(text) {
    const obj = JSON.parse(text);
    if (!obj || obj.v !== 1 || !obj.state || !obj.state.map || !obj.state.buildings) {
      throw new Error('存档格式不兼容');
    }
    // [P0] v102 旧形状/畸形窗口统一归一化(部分损坏窗口不再静默接受);无字段时保持无字段(往返一致)
    if (obj.state.ratesHistory) obj.state.ratesHistory = normalizeRatesHistory(obj.state.ratesHistory);
    return obj.state;
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.setItem(SAVE_KEY, serialize(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  // 返回存档 state;无存档/损坏/不可用 → null
  function load() {
    if (typeof localStorage === 'undefined') return null;
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      const s = deserialize(raw);
      // [用户决策] 森林移除:旧档 terrain 1(森林)→ 0(平地),避免旧档出现未知地形
      if (s && s.map && s.map.terrain) {
        for (let y = 0; y < s.map.terrain.length; y++) {
          for (let x = 0; x < s.map.terrain[y].length; x++) {
            if (s.map.terrain[y][x] === 1) s.map.terrain[y][x] = 0;
          }
        }
      }
      return s;
    } catch (e) {
      try { localStorage.setItem(BAK_KEY, raw); } catch (e2) { /* 忽略 */ }
      return null;
    }
  }

  function clearSave() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 忽略 */ }
  }

  const api = { SAVE_KEY, serialize, deserialize, save, load, clearSave, normalizeRatesHistory };
  root.Engine = root.Engine || {};
  root.Engine.save = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
