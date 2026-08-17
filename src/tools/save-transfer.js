/* save-transfer.js — 存档迁移工具的DOM-free导入/导出核心 */
(function (root) {
  'use strict';

  const FORMAT = 'web1800-save-container';
  const FORMAT_VERSION = 2;
  const UI_KEYS = ['ui.leftTab', 'ui.rightTab', 'ui.leftCollapsed', 'ui.rightCollapsed'];

  function inspectRaw(raw) {
    const env = JSON.parse(raw);
    if (!env || (env.v !== 1 && env.v !== 2) || !env.state) throw new Error('存档格式不兼容');
    const state = env.state;
    let island = state;
    let coin = state.resources && state.resources.coin;
    if (env.v === 2) {
      if (!state.islands || !state.activeIslandId || !state.islands[state.activeIslandId] || !state.treasury) {
        throw new Error('存档格式不兼容');
      }
      island = state.islands[state.activeIslandId];
      coin = state.treasury.coin;
    }
    if (!island.map || !island.buildings || !island.population) throw new Error('存档格式不兼容');
    return { env, state, island, coin };
  }

  function summarize(raw) {
    try {
      const inspected = inspectRaw(raw);
      const island = inspected.island;
      const population = Object.values(island.population).reduce((sum, value) => {
        const count = value && typeof value === 'object' ? value.count : value;
        return sum + (Number(count) || 0);
      }, 0);
      return {
        ok: true,
        version: inspected.env.v,
        ts: Number(inspected.env.ts) || 0,
        day: inspected.state.time && inspected.state.time.day,
        coin: Number(inspected.coin) || 0,
        population,
        buildings: Object.keys(island.buildings).length,
        mapSize: island.map.size,
      };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  }

  function storageEntries(storage) {
    const entries = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) entries.push([key, storage.getItem(key)]);
    }
    return entries;
  }

  function exportContainer(storage, saveApi, options) {
    const opts = options || {};
    const keys = {};
    const main = storage.getItem(saveApi.SAVE_KEY);
    if (!main) throw new Error('当前浏览器没有主存档');
    keys[saveApi.SAVE_KEY] = main;
    if (opts.includeBak) {
      const bak = storage.getItem(saveApi.BAK_KEY);
      if (bak !== null) keys[saveApi.BAK_KEY] = bak;
    }
    if (opts.includePreMigration) {
      const pre = storage.getItem(saveApi.PRE_MULTI_BACKUP_KEY);
      if (pre !== null) keys[saveApi.PRE_MULTI_BACKUP_KEY] = pre;
    }
    if (opts.includeUi) {
      const entries = new Map(storageEntries(storage));
      for (const key of UI_KEYS) {
        if (entries.has(key)) keys[key] = entries.get(key);
      }
    }
    return { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), keys };
  }

  function validateContainer(container, saveApi) {
    const currentFormat = container && container.format === FORMAT &&
      (container.version === 1 || container.version === FORMAT_VERSION);
    const legacyFormat = container && container.app === 'web1800' && container.kind === 'save-backup';
    if ((!currentFormat && !legacyFormat) || !container.keys) {
      throw new Error('不是有效的《蒸汽都市》存档包');
    }
    const main = container.keys[saveApi.SAVE_KEY];
    if (typeof main !== 'string') throw new Error('存档包缺少主存档');
    saveApi.validateSerialized(main);
    const bak = container.keys[saveApi.BAK_KEY];
    if (bak !== undefined) {
      if (typeof bak !== 'string') throw new Error('普通备份格式错误');
      saveApi.validateSerialized(bak);
    }
    const pre = container.keys[saveApi.PRE_MULTI_BACKUP_KEY];
    if (pre !== undefined) {
      if (typeof pre !== 'string') throw new Error('迁移前备份格式错误');
      saveApi.validateSerialized(pre);
    }
    const summary = summarize(main);
    if (!summary.ok) throw new Error(summary.error || '存档格式不兼容');
    return summary;
  }

  function applyImport(storage, saveApi, container) {
    const summary = validateContainer(container, saveApi);
    const allowed = new Set([saveApi.SAVE_KEY, saveApi.BAK_KEY, saveApi.PRE_MULTI_BACKUP_KEY, ...UI_KEYS]);
    const ignoredKeys = [];
    for (const [key, value] of Object.entries(container.keys)) {
      if (!allowed.has(key)) {
        ignoredKeys.push(key);
        continue;
      }
      if (typeof value !== 'string') throw new Error('存档包键值格式错误:' + key);
    }
    const current = storage.getItem(saveApi.SAVE_KEY);
    const existingBak = storage.getItem(saveApi.BAK_KEY);
    const existingPre = storage.getItem(saveApi.PRE_MULTI_BACKUP_KEY);
    const importedKeys = [];
    const skippedKeys = [];
    const writes = [];
    if (current !== null && existingBak === null) {
      writes.push({ key: saveApi.BAK_KEY, value: current, imported: false });
    }
    for (const [key, value] of Object.entries(container.keys)) {
      if (key === saveApi.SAVE_KEY) continue;
      if (!allowed.has(key)) continue;
      if ((key === saveApi.BAK_KEY && (current !== null || existingBak !== null)) ||
          (key === saveApi.PRE_MULTI_BACKUP_KEY && existingPre !== null)) {
        skippedKeys.push(key);
        continue;
      }
      writes.push({ key, value, imported: true });
    }
    writes.push({ key: saveApi.SAVE_KEY, value: container.keys[saveApi.SAVE_KEY], imported: true });
    const before = new Map();
    for (const write of writes) if (!before.has(write.key)) before.set(write.key, storage.getItem(write.key));
    try {
      for (const write of writes) {
        storage.setItem(write.key, write.value);
        if (storage.getItem(write.key) !== write.value) throw new Error('导入写入未生效:' + write.key);
        if (write.imported) importedKeys.push(write.key);
      }
    } catch (error) {
      const unrestoredKeys = [];
      const rollbackErrors = [];
      for (const [key, value] of Array.from(before.entries()).reverse()) {
        try {
          if (value === null) storage.removeItem(key);
          else storage.setItem(key, value);
        } catch (rollbackError) {
          rollbackErrors.push({ key, error: rollbackError });
        }
        try {
          if (storage.getItem(key) !== value && !unrestoredKeys.includes(key)) unrestoredKeys.push(key);
        } catch (verifyError) {
          rollbackErrors.push({ key, error: verifyError });
          if (!unrestoredKeys.includes(key)) unrestoredKeys.push(key);
        }
      }
      if (rollbackErrors.length || unrestoredKeys.length) {
        const message = unrestoredKeys.length
          ? '导入失败且回滚不完整，未恢复键:' + unrestoredKeys.join(', ')
          : '导入失败且回滚操作异常，但所有键已核验恢复';
        const rollbackFailure = new Error(message);
        rollbackFailure.code = 'IMPORT_ROLLBACK_FAILED';
        rollbackFailure.unrestoredKeys = unrestoredKeys;
        rollbackFailure.rollbackErrors = rollbackErrors;
        rollbackFailure.cause = error;
        throw rollbackFailure;
      }
      throw error;
    }
    return { summary, importedKeys, skippedKeys, ignoredKeys };
  }

  const api = { FORMAT, FORMAT_VERSION, UI_KEYS, summarize, exportContainer, validateContainer, applyImport };
  root.SaveTransferCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
