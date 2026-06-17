/* ============================================================
   config.js - 全局设置管理
   挂在全局命名空间 NW.config
   存储：localStorage
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  var KEY = "nw_settings_v1";
  var THEME_KEY = "nw_theme";

  var DEFAULTS = {
    baseUrl: "https://api.deepseek.com/v1",  // DeepSeek 默认，用户可改
    apiKey: "",
    model: "deepseek-chat",
    temperature: 0.85,        // 创作类稍高
    maxTokens: 4096,          // 单次生成上限
    platform: "fanqian",      // fanqian | qidian | zongheng
    targetWords: 2000000      // 目标字数
  };

  var cache = null;

  function load() {
    if (cache) return cache;
    try {
      var raw = localStorage.getItem(KEY);
      cache = raw ? Object.assign({}, DEFAULTS, JSON.parse(raw)) : Object.assign({}, DEFAULTS);
    } catch (e) {
      cache = Object.assign({}, DEFAULTS);
    }
    return cache;
  }

  function save(obj) {
    cache = Object.assign({}, load(), obj);
    localStorage.setItem(KEY, JSON.stringify(cache));
    return cache;
  }

  function get(key) {
    return load()[key];
  }

  function isConfigured() {
    var c = load();
    return !!(c.baseUrl && c.apiKey && c.model);
  }

  function getTheme() {
    return localStorage.getItem(THEME_KEY) || "light";
  }

  function setTheme(t) {
    localStorage.setItem(THEME_KEY, t);
    document.documentElement.setAttribute("data-theme", t);
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", getTheme());
  }

  NS.config = {
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    get: get,
    isConfigured: isConfigured,
    getTheme: getTheme,
    setTheme: setTheme,
    applyTheme: applyTheme
  };
})(window);
