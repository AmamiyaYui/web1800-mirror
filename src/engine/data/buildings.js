/* buildings.js — 建筑数据访问层
 * [V1.10 修订] 数据来源 = data/buildings-config.xlsx(可配置表格,人工可改)
 * 修改流程:编辑 Excel → python tools/gen-buildings-js.py → 刷新游戏
 * 本文件只保留查询逻辑,数值一律在 buildings-data.js(由表格生成)。
 */
(function (root) {
  'use strict';

  // 数据来自可配置表格(生成文件);加载顺序:buildings-data.js 先于本文件
  const BUILDINGS = root.Engine.buildingsData.BUILDINGS;

  function getDef(id) { return BUILDINGS[id]; }
  function list() { return Object.keys(BUILDINGS); }
  const api = { getDef, list, BUILDINGS };
  root.Engine = root.Engine || {};
  root.Engine.buildings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
