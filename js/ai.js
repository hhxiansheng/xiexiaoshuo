/* ============================================================
   ai.js - 多协议大模型客户端
   挂在全局命名空间 NW.ai

   支持三大协议族（由 js/providers.js 决定）：
   - OpenAI 兼容：DeepSeek / Kimi / GLM / 通义 / 豆包 / 硅基流动 / OpenAI / Groq / OpenRouter / Ollama…
   - Anthropic Messages API：Claude 全系
   - Google Gemini API：Gemini 全系

   对外接口保持不变：chat / chatStream / testConnection
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  function currentProvider(cfg) {
    return NS.providers.getProvider(cfg.providerId || NS.providers.DEFAULT_PROVIDER_ID);
  }

  /**
   * 非流式对话
   * @param {Object} opts { system, messages:[{role,content}], temperature?, maxTokens? }
   * @returns {Promise<string>}
   */
  function chat(opts) {
    var cfg = NS.config.load();
    var provider = currentProvider(cfg);
    var url = NS.providers.buildEndpoint(provider, cfg);
    var headers = NS.providers.buildHeaders(provider, cfg);
    var body = NS.providers.buildBody(provider, cfg, opts, false);

    return NS.http.apiFetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(formatError(res.status, t));
        });
      }
      return res.json();
    }).then(function (json) {
      var txt = NS.providers.extractText(provider, json);
      var errMsg = NS.providers.extractError(json);
      if (!txt && errMsg) throw new Error(errMsg);
      return txt || "";
    });
  }

  /**
   * 流式对话
   * @param {Object} opts 同 chat
   * @param {Function} onToken (deltaText, fullText)
   * @param {Object} signal AbortSignal
   * @returns {Promise<string>}
   */
  function chatStream(opts, onToken, signal) {
    var cfg = NS.config.load();
    var provider = currentProvider(cfg);
    var url = NS.providers.buildStreamEndpoint(provider, cfg);
    var headers = NS.providers.buildHeaders(provider, cfg);
    var body = NS.providers.buildBody(provider, cfg, opts, true);

    return NS.http.apiFetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      signal: signal
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(formatError(res.status, t));
        });
      }
      if (!res.body) {
        return res.json().then(function (json) {
          var txt = NS.providers.extractText(provider, json);
          if (txt && onToken) onToken(txt, txt);
          return txt;
        });
      }
      return readSSE(res.body, provider, onToken);
    });
  }

  // 解析 SSE 流
  function readSSE(body, provider, onToken) {
    var reader = body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buffer = "";
    var full = "";
    var isGoogle = provider.protocol === NS.providers.PROTOCOLS.GOOGLE;

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) return full;
        buffer += decoder.decode(chunk.value, { stream: true });

        var lines = buffer.split("\n");
        buffer = lines.pop();

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          if (line.indexOf("data:") !== 0) continue;

          var data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") return full;

          var json;
          try {
            json = JSON.parse(data);
          } catch (e) {
            continue; // 心跳/注释
          }

          var errMsg = NS.providers.extractError(json);
          if (errMsg && !NS.providers.extractDelta(provider, json)) {
            throw new Error(errMsg);
          }

          if (isGoogle && json.candidates && json.candidates[0]) {
            var fr = json.candidates[0].finishReason;
            if (fr && fr !== "STOP" && fr !== "MAX_TOKENS") {
              if (!NS.providers.extractDelta(provider, json)) {
                throw new Error("Gemini 中断生成：" + fr);
              }
            }
          }

          var delta = NS.providers.extractDelta(provider, json);
          if (delta) {
            full += delta;
            if (onToken) onToken(delta, full);
          }
        }
        return pump();
      });
    }
    return pump();
  }

  // 测试连接
  function testConnection() {
    return chat({
      system: "你是一个测试助手。",
      messages: [{ role: "user", content: "请只回复四个字：连接成功" }],
      maxTokens: 32
    }).then(function (txt) {
      return { ok: true, reply: txt };
    });
  }

  // 列出可用模型（部分厂商支持 /models）
  function listModels() {
    var cfg = NS.config.load();
    var provider = currentProvider(cfg);
    var url;

    if (provider.protocol === NS.providers.PROTOCOLS.GOOGLE) {
      url = String(cfg.baseUrl || provider.baseUrl).replace(/\/+$/, "") + "/models";
    } else if (provider.protocol === NS.providers.PROTOCOLS.ANTHROPIC) {
      return Promise.reject(new Error("该厂商不支持自动拉取模型列表，请手动填写模型名"));
    } else {
      var base = String(cfg.baseUrl || provider.baseUrl).replace(/\/+$/, "");
      url = base + "/models";
    }

    var headers = NS.providers.buildHeaders(provider, cfg);

    return NS.http.apiFetch(url, { method: "GET", headers: headers }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(formatError(res.status, t));
        });
      }
      return res.json();
    }).then(function (json) {
      if (json.data && Array.isArray(json.data)) {
        return json.data.map(function (m) { return m.id || m.name; }).filter(Boolean);
      }
      if (json.models && Array.isArray(json.models)) {
        return json.models.map(function (m) { return m.name || m.id; }).filter(Boolean);
      }
      return [];
    });
  }

  function formatError(status, bodyText) {
    var detail = sliceErr(bodyText);
    var hint = statusHint(status, bodyText);
    return "API 错误 (" + status + ")" + (hint ? "：" + hint : "") + (detail ? "\n" + detail : "");
  }

  function statusHint(status, bodyText) {
    var raw = String(bodyText || "");

    // 先看服务端返回的具体错误类型，能给出更精准的提示
    if (/MissingSessionID/i.test(raw)) {
      return "服务端要求 x-opencode-session 头。已为 OpenCode Go 自动注入，若仍报错请确认厂商选择正确";
    }
    if (/authentication_error|Invalid credential|invalid_api_key/i.test(raw)) {
      return "API Key 无效，请检查是否填错或已过期";
    }
    if (/model.*not.*(found|exist)|invalid.*model/i.test(raw)) {
      return "模型名不存在，请检查拼写";
    }
    if (/insufficient.*(quota|balance)|余额不足/i.test(raw)) {
      return "账户余额或额度不足";
    }

    switch (status) {
      case 400: return "请求参数有误，请检查模型名是否正确";
      case 401: return "API Key 无效或未填写";
      case 403: return "API Key 无权访问该模型";
      case 404: return "端点或模型不存在，请检查 Base URL";
      case 405: return "该路径不支持此请求方法，请检查 Base URL 是否写错（例如少了或多了 /zen）";
      case 413: return "请求体过大，请减少大纲/上下文字数";
      case 429: return "请求频率或额度超限，请稍后再试";
      case 500:
      case 502:
      case 503: return "服务端错误，请稍后重试";
      default: return "";
    }
  }

  function sliceErr(t) {
    if (!t) return "";
    var s = String(t);
    return s.length > 400 ? (s.slice(0, 400) + "…") : s;
  }

  NS.ai = {
    chat: chat,
    chatStream: chatStream,
    testConnection: testConnection,
    listModels: listModels
  };
})(window);
