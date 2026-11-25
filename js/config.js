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
    providerId: "deepseek",   // 厂商预设 id，见 js/providers.js
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",
    temperature: 0.85,        // 创作类稍高
    maxTokens: 4096,          // 单次生成上限
    omitTemperature: false,   // 推理模型不支持 temperature 时勾选
    extraHeaders: "",         // 自定义附加请求头（JSON）
    platform: "fanqian",      // fanqian | qidian | zongheng
    targetWords: 2000000      // 目标字数
  };

  var cache = null;

  // 规范化设置：修正 providerId 与 baseUrl 不一致的遗留配置
  function normalize(cfg) {
    var out = {};
    Object.keys(cfg).forEach(function (k) { out[k] = cfg[k]; });
    var pid = out.providerId || "deepseek";
    out.providerId = pid;

    // 若 baseUrl 是「另一个厂商」的预设端点，说明用户切换过厂商但 baseUrl 没跟上，
    // 此时按当前厂商的默认端点纠正，避免请求发往错误服务
    var list = (NS.providers && NS.providers.PROVIDERS) || [];
    var norm = String(out.baseUrl || "").replace(/\/+$/, "");
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item.id === pid || item.id === "custom") continue;
      var pBase = String(item.baseUrl || "").replace(/\/+$/, "");
      if (pBase && norm === pBase) {
        var target = null;
        for (var j = 0; j < list.length; j++) {
          if (list[j].id === pid) { target = list[j]; break; }
        }
        if (target && target.baseUrl) out.baseUrl = target.baseUrl;
        break;
      }
    }
    return out;
  }

  function load() {
    if (cache) return cache;
    try {
      var raw = localStorage.getItem(KEY);
      cache = normalize(raw ? Object.assign({}, DEFAULTS, JSON.parse(raw)) : Object.assign({}, DEFAULTS));
    } catch (e) {
      cache = Object.assign({}, DEFAULTS);
    }
    return cache;
  }

  function save(obj) {
    cache = normalize(Object.assign({}, load(), obj));
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
