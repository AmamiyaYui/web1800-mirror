/* world-data.js — 世界/岛屿schema与已批准的多岛基础配置 */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const MAP_SIZE = 160;
  const LEGACY_MAP_SIZE = 128;
  const LEGACY_MAP_OFFSET = 16;
  const MAX_OWNED_ISLANDS = 12;
  const MAIN_ISLAND_ID = 'island-main';
  const PRE_MULTI_BACKUP_KEY = 'web1800-save-v1.pre-multi-island';

  const MAIN_FERTILITIES = Object.freeze(['potato', 'grain', 'hops', 'pepper', 'grapes']);
  // [B-64/REQ-37] 普通正式岛 4 植物/4 矿物上限;新游戏主岛保底土豆/谷物/啤酒花 + 黏土/铁,
  // 剩余槽位确定性随机(煤矿不属于开局保底,煤商品由炭窑获得)
  const ISLAND_MAX_FERTILITIES = 4;
  const ISLAND_MAX_DEPOSITS = 4;
  const MAIN_BASE_FERTILITIES = Object.freeze(['potato', 'grain', 'hops']);
  const MAIN_FERTILITY_POOL = Object.freeze(['pepper', 'grapes']);
  const MAIN_BASE_DEPOSITS = Object.freeze(['clay', 'iron']);
  const MAIN_DEPOSIT_POOL = Object.freeze(['coal', 'copper', 'zinc', 'limestone', 'gold']);
  const MINERAL_TYPES = Object.freeze(['clay', 'iron', 'coal', 'limestone', 'zinc', 'copper', 'gold']);
  const MAIN_INITIAL_RESOURCES = Object.freeze({ coin: 5000, wood: 60, fish: 100 });
  const NEW_ISLAND_INITIAL_RESOURCES = Object.freeze({ wood: 20, fish: 100 });
  const DEPOSIT_GROUPS = Object.freeze({
    clay: Object.freeze({ min: 3, max: 4, size: 5 }),
    iron: Object.freeze({ min: 5, max: 6, size: 3 }),
    coal: Object.freeze({ min: 4, max: 5, size: 3 }),
    copper: Object.freeze({ min: 3, max: 4, size: 3 }),
    zinc: Object.freeze({ min: 2, max: 3, size: 3 }),
    limestone: Object.freeze({ min: 2, max: 3, size: 3 }),
    gold: Object.freeze({ min: 1, max: 2, size: 3 }),
  });

  const api = {
    SCHEMA_VERSION,
    MAP_SIZE,
    LEGACY_MAP_SIZE,
    LEGACY_MAP_OFFSET,
    MAX_OWNED_ISLANDS,
    MAIN_ISLAND_ID,
    PRE_MULTI_BACKUP_KEY,
    MAIN_FERTILITIES,
    ISLAND_MAX_FERTILITIES,
    ISLAND_MAX_DEPOSITS,
    MAIN_BASE_FERTILITIES,
    MAIN_FERTILITY_POOL,
    MAIN_BASE_DEPOSITS,
    MAIN_DEPOSIT_POOL,
    MINERAL_TYPES,
    MAIN_INITIAL_RESOURCES,
    NEW_ISLAND_INITIAL_RESOURCES,
    DEPOSIT_GROUPS,
  };

  root.Engine = root.Engine || {};
  root.Engine.worldData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
