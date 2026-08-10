/* mode.js — 模式按钮高亮(检查/建造/铺路/拆除) */
(function (root) {
  'use strict';

  const BTN_IDS = { inspect: 'btn-inspect', move: 'btn-move', road: 'btn-road', demolish: 'btn-demolish', build: 'btn-build' };

  function set(mode) {
    for (const [m, id] of Object.entries(BTN_IDS)) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', m === mode);
    }
  }

  root.UI = root.UI || {};
  root.UI.mode = { set };
})(typeof globalThis !== 'undefined' ? globalThis : this);
