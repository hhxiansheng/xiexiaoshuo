/* ============================================================
   ai.js - OpenAI 兼容大模型客户端
   挂在全局命名空间 NW.ai
   功能：
   - 非流式 chat completion
   - 流式 chat completion（SSE 解析，逐 token 回调）
   - 测试连接
   适配 DeepSeek / OpenAI / 通义千问(兼容模式) 等任意 OpenAI 兼容服务
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  // 规范化 base url，保证以 /chat/completions 结尾
  function buildUrl(baseUrl) {
    var u = (baseUrl || "").replace(/\/+$/, "");
    if (/\/chat\/completions$/.test(u)) return u;
    if (/\/v\d+$/.test(u)) return u + "/chat/completions";
    return u + "/v1/chat/completions";
  }

  function buildHeaders(apiKey) {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (apiKey || "")
    };
  }

  /**
   * 非流式对话
   * @param {Object} opts { system, messages:[{role,content}], temperature?, maxTokens? }
   * @returns {Promise<string>} 助手回复文本
   */
  function chat(opts) {
    var cfg = NS.config.load();
    var payload = {
      model: cfg.model,
      messages: []
    };
    if (opts.system) payload.messages.push({ role: "system", content: opts.system });
    (opts.messages || []).forEach(function (m) { payload.messages.push(m); });
    payload.temperature = opts.temperature != null ? opts.temperature : cfg.temperature;
    payload.max_tokens = opts.maxTokens != null ? opts.maxTokens : cfg.maxTokens;
    payload.stream = false;

    return fetch(buildUrl(cfg.baseUrl), {
      method: "POST",
      headers: buildHeaders(cfg.apiKey),
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) {
        throw new Error("API 错误 (" + res.status + "): " + sliceErr(t));
      });
      return res.json();
    }).then(function (data) {
      var txt = data && data.choices && data.choices[0] && data.choices[0].message &&
                data.choices[0].message.content;
      return txt || "";
    });
  }

  /**
   * 流式对话
   * @param {Object} opts 同 chat
   * @param {Function} onToken  回调 (deltaText, fullText)
   * @param {Object}   signal   AbortSignal，用于中断
   * @returns {Promise<string>} 完整文本
   */
  function chatStream(opts, onToken, signal) {
    var cfg = NS.config.load();
    var payload = {
      model: cfg.model,
      messages: [],
      stream: true
    };
    if (opts.system) payload.messages.push({ role: "system", content: opts.system });
    (opts.messages || []).forEach(function (m) { payload.messages.push(m); });
    payload.temperature = opts.temperature != null ? opts.temperature : cfg.temperature;
    payload.max_tokens = opts.maxTokens != null ? opts.maxTokens : cfg.maxTokens;

    return fetch(buildUrl(cfg.baseUrl), {
      method: "POST",
      headers: buildHeaders(cfg.apiKey),
      body: JSON.stringify(payload),
      signal: signal
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.text().then(function (t) {
          throw new Error("API 错误 (" + res.status + "): " + sliceErr(t));
        });
      }
      return readSSE(res.body, onToken);
    });
  }

  // 解析 SSE 流
  function readSSE(body, onToken) {
    var reader = body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buffer = "";
    var full = "";

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) return full;
        buffer += decoder.decode(chunk.value, { stream: true });

        // 按 SSE 事件分割
        var lines = buffer.split("\n");
        buffer = lines.pop(); // 保留最后不完整的一行

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          if (line.indexOf("data:") !== 0) continue;
          var data = line.slice(5).trim();
          if (data === "[DONE]") return full;
          try {
            var json = JSON.parse(data);
            var delta = json.choices && json.choices[0] && json.choices[0].delta &&
                        json.choices[0].delta.content;
            if (delta) {
              full += delta;
              if (onToken) onToken(delta, full);
            }
          } catch (e) {
            // 忽略解析错误（如心跳/注释）
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
      messages: [{ role: "user", content: "请回复：连接成功" }],
      maxTokens: 20
    }).then(function (txt) {
      return { ok: true, reply: txt };
    });
  }

  function sliceErr(t) {
    if (!t) return "";
    if (t.length > 300) t = t.slice(0, 300);
    return t;
  }

  NS.ai = {
    chat: chat,
    chatStream: chatStream,
    testConnection: testConnection
  };
})(window);
