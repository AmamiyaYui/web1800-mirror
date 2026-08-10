/* events.js — 引擎事件总线(引擎 → UI 的唯一通道) */
(function (root) {
  'use strict';

  const listeners = {};

  function on(event, fn) {
    (listeners[event] = listeners[event] || []).push(fn);
  }

  function off(event, fn) {
    const arr = listeners[event];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  function emit(event, payload) {
    const arr = listeners[event];
    if (arr) arr.slice().forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
  }

  function clear() {
    for (const k of Object.keys(listeners)) delete listeners[k];
  }

  const api = { on, off, emit, clear };
  root.Engine = root.Engine || {};
  root.Engine.events = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
