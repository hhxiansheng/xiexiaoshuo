/* ============================================================
   http.js - 带代理回退的 fetch 封装
   挂在全局命名空间 NW.http

   问题背景：
   很多 AI 服务的 /chat/completions 端点不给浏览器发 CORS 头，
   浏览器在发送 POST 前的 OPTIONS 预检阶段就会拒绝整个请求，
   fetch 抛出 `TypeError: Failed to fetch`，请求体根本没发出去。
   而 /models 这类 GET 端点往往允许跨域，于是出现
   「能拉到模型列表，但测试连接失败」的怪现象。

   解决思路：
   1. 先尝试直连（本地模型、CORS 友好的服务不需要代理）
   2. 直连抛网络层错误时，自动改用同源代理转发
   3. 记住本次会话的结果，后续请求直接走代理
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  var PROXY_PATH = "/api/proxy";
  var mode = "unknown"; // 'unknown' | 'direct' | 'proxy'

  // 本次「对话」的稳定会话 ID。
  // 部分服务（如 OpenCode Go）要求 x-opencode-session 以便路由与提示缓存。
  var sessionId = "";

  function makeSessionId() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {
      // 忽略
    }
    return "sess-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getSessionId() {
    if (!sessionId) sessionId = makeSessionId();
    return sessionId;
  }

  function newSession() {
    sessionId = makeSessionId();
    return sessionId;
  }

  function getConnectionMode() { return mode; }
  function resetConnectionMode() { mode = "unknown"; }

  // 判断是否为「网络层失败」——这类错误值得重试代理
  function isNetworkFailure(err) {
    if (!err) return false;
    if (err.name === "AbortError") return false;
    if (err instanceof TypeError) return true;
    var msg = String(err.message || "");
    return /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg);
  }

  function buildProxyUrl(targetUrl) {
    var sep = PROXY_PATH.indexOf("?") >= 0 ? "&" : "?";
    return PROXY_PATH + sep + "url=" + encodeURIComponent(targetUrl);
  }

  function proxyFetch(targetUrl, options) {
    return fetch(buildProxyUrl(targetUrl), options);
  }

  /**
   * 发起 API 请求，必要时自动走代理
   */
  function apiFetch(url, options) {
    options = options || {};

    if (mode === "proxy") {
      return proxyFetch(url, options);
    }

    return fetch(url, options).then(function (res) {
      if (mode === "unknown") mode = "direct";
      return res;
    }).catch(function (err) {
      if (!isNetworkFailure(err)) throw err;

      return proxyFetch(url, options).then(function (res) {
        mode = "proxy";
        return res;
      }).catch(function (proxyErr) {
        if (proxyErr.name === "AbortError") throw proxyErr;
        throw new Error(buildNetworkError(url, err, proxyErr));
      });
    });
  }

  function buildNetworkError(url, directErr, proxyErr) {
    var host = "";
    try {
      host = new URL(url).host;
    } catch (e) {
      host = url;
    }

    var lines = [
      "无法连接到 " + host,
      "",
      "可能原因：",
      "1. 该服务未开放浏览器跨域（CORS），且本地代理未启动",
      "2. 地址写错或服务不可达",
      "3. 网络/防火墙拦截",
      "",
      "排查建议：",
      "- 本项目的代理需要 Node 环境：运行 `node server.js` 启动",
      "- 直接双击 index.html 打开时没有代理，跨域服务必然失败"
    ];

    if (directErr && directErr.message) lines.push("", "直连错误：" + directErr.message);
    if (proxyErr && proxyErr.message) lines.push("代理错误：" + proxyErr.message);
    return lines.join("\n");
  }

  NS.http = {
    PROXY_PATH: PROXY_PATH,
    getConnectionMode: getConnectionMode,
    resetConnectionMode: resetConnectionMode,
    getSessionId: getSessionId,
    newSession: newSession,
    apiFetch: apiFetch
  };
})(window);
