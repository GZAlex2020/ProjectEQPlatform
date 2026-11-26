/* 本地持久化：项目需求 + 报价结果 + 费率配置
 * GitHub Pages 无后端，数据保存在浏览器 localStorage，并提供 JSON 导入导出做备份/迁移。
 */
(function () {
  'use strict';

  var KEY_RECORDS = 'est_platform_records_v1';
  var KEY_CONFIG  = 'est_platform_config_v1';

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[storage] 读取失败', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e && e.name === 'QuotaExceededError'
        ? '本地存储空间不足，请先导出备份并清理历史记录' : '保存失败：' + (e && e.message) };
    }
  }

  function makeId() {
    return 'prj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function deepMerge(base, override) {
    var out = JSON.parse(JSON.stringify(base));
    if (!override || typeof override !== 'object') return out;
    Object.keys(override).forEach(function (k) {
      if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k]) &&
          out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = deepMerge(out[k], override[k]);
      } else {
        out[k] = override[k];
      }
    });
    return out;
  }

  // ---- 费率配置 ----
  function getConfig() {
    var saved = read(KEY_CONFIG, null);
    return deepMerge(window.APP_DATA, saved);
  }

  function saveConfig(cfg) { return write(KEY_CONFIG, cfg); }

  function resetConfig() {
    try { localStorage.removeItem(KEY_CONFIG); return true; } catch (e) { return false; }
  }

  // ---- 项目与报价记录 ----
  function list() {
    var items = read(KEY_RECORDS, []);
    if (!Array.isArray(items)) return [];
    return items.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }

  function get(id) {
    return list().filter(function (r) { return r.id === id; })[0] || null;
  }

  function save(record) {
    var items = read(KEY_RECORDS, []);
    if (!Array.isArray(items)) items = [];
    if (!record.id) record.id = makeId();
    var now = new Date().toISOString();
    if (!record.createdAt) record.createdAt = now;
    record.updatedAt = now;
    var idx = -1;
    for (var i = 0; i < items.length; i++) { if (items[i].id === record.id) { idx = i; break; } }
    if (idx >= 0) items[idx] = record; else items.unshift(record);
    var res = write(KEY_RECORDS, items);
    return { ok: res.ok, error: res.error, id: record.id };
  }

  function remove(id) {
    var items = list().filter(function (r) { return r.id !== id; });
    return write(KEY_RECORDS, items);
  }

  function clearAll() { return write(KEY_RECORDS, []); }

  // ---- 备份 / 迁移 ----
  function buildBackup() {
    return {
      format: 'estimate-platform-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      config: read(KEY_CONFIG, null),
      records: list()
    };
  }

  function exportToFile() {
    var data = buildBackup();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    a.href = url;
    a.download = '项目报价备份_' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return data.records.length;
  }

  function importFromFile(file, mode) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          if (data.format !== 'estimate-platform-backup' || !Array.isArray(data.records)) {
            throw new Error('不是有效的备份文件（缺少 format / records）');
          }
          var incoming = data.records.filter(function (r) {
            return r && r.id && r.requirement && r.result;
          });
          var existing = list();
          var merged;
          if (mode === 'replace') {
            merged = incoming;
          } else {
            var map = {};
            existing.forEach(function (r) { map[r.id] = r; });
            incoming.forEach(function (r) { map[r.id] = r; });
            merged = Object.keys(map).map(function (k) { return map[k]; });
          }
          var res = write(KEY_RECORDS, merged);
          if (!res.ok) throw new Error(res.error);
          if (data.config) write(KEY_CONFIG, data.config);
          resolve({ count: incoming.length, total: merged.length });
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  function stats() {
    var items = list();
    var bytes = 0;
    try { bytes = new Blob([localStorage.getItem(KEY_RECORDS) || '']).size; } catch (e) { /* ignore */ }
    return { count: items.length, bytes: bytes };
  }

  window.Storage = {
    getConfig: getConfig, saveConfig: saveConfig, resetConfig: resetConfig,
    list: list, get: get, save: save, remove: remove, clearAll: clearAll,
    buildBackup: buildBackup, exportToFile: exportToFile, importFromFile: importFromFile,
    stats: stats, makeId: makeId
  };
})();
