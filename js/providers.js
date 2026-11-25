/* ============================================================
   providers.js - 模型厂商注册表 + 协议适配层
   挂在全局命名空间 NW.providers

   支持三大协议族：
   1. openai    → OpenAI 兼容（DeepSeek / Kimi / GLM / 通义 / 硅基流动 / Groq / OpenRouter / Ollama…）
   2. anthropic → Anthropic Messages API（Claude 全系）
   3. google    → Google Gemini API（Gemini 全系）
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  var PROTOCOLS = {
    OPENAI: "openai",
    ANTHROPIC: "anthropic",
    GOOGLE: "google"
  };

  var AUTH_TYPES = {
    BEARER: "bearer",
    X_API_KEY: "x-api-key",
    API_KEY: "api-key",
    GOOGLE_KEY: "x-goog-api-key",
    NONE: "none"
  };

  var PROVIDER_GROUPS = [
    { key: "cn", label: "国内厂商" },
    { key: "global", label: "国际厂商" },
    { key: "local", label: "本地 / 自建" },
    { key: "custom", label: "自定义" }
  ];

  var PROVIDERS = [
    // ============ 国内 ============
    {
      id: "deepseek", group: "cn", name: "DeepSeek 深度求索",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.deepseek.com/v1",
      models: ["deepseek-chat", "deepseek-reasoner"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192,
      note: "deepseek-chat 适合正文创作；deepseek-reasoner 为推理模型，不支持 temperature"
    },
    {
      id: "moonshot", group: "cn", name: "月之暗面 Kimi",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.moonshot.cn/v1",
      models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-k2-0905-preview"],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 8192
    },
    {
      id: "zhipu", group: "cn", name: "智谱 GLM",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      models: ["glm-4-plus", "glm-4.5", "glm-4-flash", "glm-4-long"],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 8192
    },
    {
      id: "dashscope", group: "cn", name: "阿里通义千问",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192,
      note: "使用「兼容模式」端点，与 OpenAI SDK 一致"
    },
    {
      id: "volcengine", group: "cn", name: "字节豆包（火山方舟）",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      models: ["doubao-pro-32k", "doubao-pro-128k", "doubao-lite-32k"],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 4096,
      note: "模型名需填写你在方舟控制台创建的「接入点 ID」，形如 ep-2024xxxx"
    },
    {
      id: "siliconflow", group: "cn", name: "硅基流动 SiliconFlow",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.siliconflow.cn/v1",
      models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192,
      note: "聚合平台，一个 Key 可用多家开源模型"
    },
    {
      id: "minimax", group: "cn", name: "MiniMax",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.minimax.chat/v1",
      models: ["abab6.5s-chat", "abab6.5g-chat"],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 8192
    },
    {
      id: "stepfun", group: "cn", name: "阶跃星辰 StepFun",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.stepfun.com/v1",
      models: ["step-1-8k", "step-1-32k", "step-2-16k"],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 8192
    },
    {
      id: "baichuan", group: "cn", name: "百川智能",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.baichuan-ai.com/v1",
      models: ["Baichuan4", "Baichuan3-Turbo"],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 4096
    },
    {
      id: "lingyi", group: "cn", name: "零一万物 Yi",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.lingyiwanwu.com/v1",
      models: ["yi-large", "yi-medium", "yi-lightning"],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 4096
    },

    // ============ 国际 ============
    {
      id: "openai", group: "global", name: "OpenAI",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
      maxTokensField: "max_completion_tokens", tempMax: 2, maxOutput: 16384,
      note: "o1/o3 等推理模型不支持 temperature，且必须用 max_completion_tokens"
    },
    {
      id: "anthropic", group: "global", name: "Anthropic Claude",
      protocol: PROTOCOLS.ANTHROPIC, authType: AUTH_TYPES.X_API_KEY,
      baseUrl: "https://api.anthropic.com/v1",
      models: [
        "claude-sonnet-4-20250514",
        "claude-opus-4-20250514",
        "claude-3-7-sonnet-latest",
        "claude-3-5-haiku-latest"
      ],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 8192,
      note: "系统提示词为独立字段；浏览器直连会自动加 CORS 允许头"
    },
    {
      id: "google", group: "global", name: "Google Gemini",
      protocol: PROTOCOLS.GOOGLE, authType: AUTH_TYPES.GOOGLE_KEY,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"],
      maxTokensField: "maxOutputTokens", tempMax: 2, maxOutput: 8192,
      note: "角色只有 user / model 两种，内部会自动转换"
    },
    {
      id: "xai", group: "global", name: "xAI Grok",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.x.ai/v1",
      models: ["grok-2-latest", "grok-beta"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192
    },
    {
      id: "groq", group: "global", name: "Groq",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.groq.com/openai/v1",
      models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192,
      note: "推理速度极快，适合批量生成"
    },
    {
      id: "mistral", group: "global", name: "Mistral AI",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.mistral.ai/v1",
      models: ["mistral-large-latest", "mistral-small-latest", "open-mistral-nemo"],
      maxTokensField: "max_tokens", tempMax: 1, maxOutput: 8192
    },
    {
      id: "openrouter", group: "global", name: "OpenRouter",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://openrouter.ai/api/v1",
      models: [
        "anthropic/claude-sonnet-4",
        "deepseek/deepseek-chat",
        "google/gemini-2.5-pro",
        "openai/gpt-4o"
      ],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 16384,
      note: "聚合平台，一个 Key 可用上百种模型，模型名带厂商前缀"
    },
    {
      id: "opencode", group: "global", name: "OpenCode Go",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://opencode.ai/zen/go/v1",
      models: ["deepseek-v4.1-flash", "deepseek-v4-pro", "glm-5.3", "grok-4.7", "gpt-6-luna"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192,
      requiresSession: true,
      customUserAgent: "xiexiaoshuo/1.0",
      corsBlocked: true,
      note: "必须带 x-opencode-session 头（已自动注入）；该服务不开放浏览器跨域，需走本地代理"
    },
    {
      id: "together", group: "global", name: "Together AI",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "https://api.together.xyz/v1",
      models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192
    },

    // ============ 本地 / 自建 ============
    {
      id: "ollama", group: "local", name: "Ollama（本地）",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.NONE,
      baseUrl: "http://localhost:11434/v1",
      models: ["qwen2.5:14b", "llama3.1:8b", "deepseek-r1:14b"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192,
      note: "需要先在本机运行 ollama serve；无需 API Key"
    },
    {
      id: "lmstudio", group: "local", name: "LM Studio（本地）",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "http://localhost:1234/v1",
      models: ["local-model"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192,
      note: "LM Studio 的 Key 可随便填，它不校验"
    },
    {
      id: "azure", group: "local", name: "Azure OpenAI",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.API_KEY,
      baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT",
      models: ["gpt-4o"],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 4096,
      extraQuery: "api-version=2024-10-21",
      note: "把 YOUR-RESOURCE 和 YOUR-DEPLOYMENT 换成你的资源名与部署名；鉴权用 api-key 头"
    },

    // ============ 自定义 ============
    {
      id: "custom", group: "custom", name: "自定义（OpenAI 兼容）",
      protocol: PROTOCOLS.OPENAI, authType: AUTH_TYPES.BEARER,
      baseUrl: "",
      models: [],
      maxTokensField: "max_tokens", tempMax: 2, maxOutput: 8192,
      note: "填入任意 OpenAI 兼容服务的 Base URL，例如 https://your-host/v1"
    }
  ];

  var DEFAULT_PROVIDER_ID = "deepseek";

  // 会话 ID 生成器由 http.js 注入，避免循环依赖
  var sessionIdProvider = null;

  function setSessionIdProvider(fn) { sessionIdProvider = fn; }

  function getProvider(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i];
    }
    return getProvider2(DEFAULT_PROVIDER_ID);
  }
  function getProvider2(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i];
    }
    return PROVIDERS[0];
  }

  function getProvidersByGroup() {
    var out = [];
    PROVIDER_GROUPS.forEach(function (g) {
      var list = PROVIDERS.filter(function (p) { return p.group === g.key; });
      if (list.length) out.push({ key: g.key, label: g.label, providers: list });
    });
    return out;
  }

  // ---------------- 端点 ----------------
  function trimSlash(s) {
    return String(s || "").replace(/\/+$/, "");
  }

  function buildEndpoint(provider, cfg) {
    var base = trimSlash(cfg.baseUrl || provider.baseUrl);
    if (!base) throw new Error("请填写 API Base URL");

    // Azure：base 里已含 deployments
    if (provider.extraQuery) {
      var hasPath = /\/chat\/completions$/.test(base);
      var azUrl = hasPath ? base : (base + "/chat/completions");
      return azUrl + (azUrl.indexOf("?") >= 0 ? "&" : "?") + provider.extraQuery;
    }

    if (provider.protocol === PROTOCOLS.ANTHROPIC) {
      if (/\/messages$/.test(base)) return base;
      return base + "/messages";
    }

    if (provider.protocol === PROTOCOLS.GOOGLE) {
      var model = cfg.model || (provider.models && provider.models[0]) || "";
      if (!model) throw new Error("请填写模型名");
      return trimSlash(base) + "/models/" + model + ":generateContent";
    }

    // OpenAI 兼容
    if (/\/chat\/completions$/.test(base)) return base;
    if (/\/v\d+[a-z0-9]*$/i.test(base)) return base + "/chat/completions";
    return base + "/v1/chat/completions";
  }

  function buildStreamEndpoint(provider, cfg) {
    if (provider.protocol === PROTOCOLS.GOOGLE) {
      var url = buildEndpoint(provider, cfg);
      return url.replace(":generateContent", ":streamGenerateContent") + "?alt=sse";
    }
    return buildEndpoint(provider, cfg);
  }

  // ---------------- 请求头 ----------------
  function buildHeaders(provider, cfg) {
    var headers = { "Content-Type": "application/json" };
    var key = cfg.apiKey || "";

    switch (provider.authType) {
      case AUTH_TYPES.X_API_KEY:
        if (key) headers["x-api-key"] = key;
        headers["anthropic-version"] = "2023-06-01";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
        break;
      case AUTH_TYPES.API_KEY:
        if (key) headers["api-key"] = key;
        break;
      case AUTH_TYPES.GOOGLE_KEY:
        if (key) headers["x-goog-api-key"] = key;
        break;
      case AUTH_TYPES.NONE:
        break;
      default:
        if (key) headers.Authorization = "Bearer " + key;
        break;
    }

    // 部分服务要求标识客户端与会话（如 OpenCode Go 的 x-opencode-session）
    if (provider.requiresSession && sessionIdProvider) {
      headers["x-opencode-session"] = sessionIdProvider();
    }
    if (provider.customUserAgent) {
      headers["User-Agent"] = provider.customUserAgent;
    }

    if (cfg.extraHeaders && String(cfg.extraHeaders).trim()) {      try {
        var extra = JSON.parse(cfg.extraHeaders);
        Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });
      } catch (e) {
        // 非法 JSON 忽略
      }
    }
    return headers;
  }

  // ---------------- 请求体 ----------------
  function clampTemperature(provider, t) {
    var n = typeof t === "number" ? t : parseFloat(t);
    if (!isFinite(n)) return 0.85;
    var max = provider.tempMax || 2;
    return Math.max(0, Math.min(max, n));
  }

  function buildMaxTokens(provider, cfg, requested) {
    var n = requested != null ? requested : cfg.maxTokens;
    n = parseInt(n, 10);
    if (!isFinite(n) || n <= 0) n = 4096;
    var limit = provider.maxOutput || 8192;
    return Math.min(n, limit);
  }

  function buildBody(provider, cfg, opts, stream) {
    var temperature = opts.temperature != null ? opts.temperature : cfg.temperature;
    var maxTokens = buildMaxTokens(provider, cfg, opts.maxTokens);
    var messages = opts.messages || [];
    var system = opts.system || "";

    if (provider.protocol === PROTOCOLS.ANTHROPIC) {
      var aBody = {
        model: cfg.model,
        max_tokens: maxTokens,
        messages: messages.map(function (m) {
          return {
            role: m.role === "assistant" ? "assistant" : "user",
            content: typeof m.content === "string" ? m.content : String(m.content || "")
          };
        })
      };
      if (system) aBody.system = system;
      if (stream) aBody.stream = true;
      aBody.temperature = clampTemperature(provider, temperature);
      return aBody;
    }

    if (provider.protocol === PROTOCOLS.GOOGLE) {
      var contents = messages.map(function (m) {
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: typeof m.content === "string" ? m.content : String(m.content || "") }]
        };
      });
      var gBody = {
        contents: contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: clampTemperature(provider, temperature)
        }
      };
      if (system) gBody.systemInstruction = { parts: [{ text: system }] };
      return gBody;
    }

    // OpenAI 兼容
    var body = { model: cfg.model, messages: [] };
    if (system) body.messages.push({ role: "system", content: system });
    messages.forEach(function (m) { body.messages.push(m); });

    if (!cfg.omitTemperature) {
      body.temperature = clampTemperature(provider, temperature);
    }
    body[provider.maxTokensField || "max_tokens"] = maxTokens;
    body.stream = !!stream;
    return body;
  }

  // ---------------- 响应解析 ----------------
  function extractDelta(provider, json) {
    if (!json) return "";

    if (provider.protocol === PROTOCOLS.ANTHROPIC) {
      if (json.type === "content_block_delta" && json.delta && json.delta.text) {
        return json.delta.text;
      }
      return "";
    }

    if (provider.protocol === PROTOCOLS.GOOGLE) {
      var c = json.candidates && json.candidates[0];
      var parts = c && c.content && c.content.parts;
      if (parts && parts.length) {
        return parts.map(function (p) { return p.text || ""; }).join("");
      }
      return "";
    }

    var choice = json.choices && json.choices[0];
    if (!choice) return "";
    var d = choice.delta;
    if (d && typeof d.content === "string") return d.content;
    if (choice.message && typeof choice.message.content === "string") return choice.message.content;
    return "";
  }

  function extractText(provider, json) {
    if (!json) return "";

    if (provider.protocol === PROTOCOLS.ANTHROPIC) {
      if (Array.isArray(json.content)) {
        return json.content
          .filter(function (b) { return b.type === "text"; })
          .map(function (b) { return b.text || ""; })
          .join("");
      }
      return "";
    }

    if (provider.protocol === PROTOCOLS.GOOGLE) {
      var c = json.candidates && json.candidates[0];
      var parts = c && c.content && c.content.parts;
      if (parts && parts.length) {
        return parts.map(function (p) { return p.text || ""; }).join("");
      }
      return "";
    }

    var choice = json.choices && json.choices[0];
    if (choice && choice.message && typeof choice.message.content === "string") {
      return choice.message.content;
    }
    return "";
  }

  function extractError(json) {
    if (!json || !json.error) return "";
    if (typeof json.error === "string") return json.error;
    return json.error.message || json.error.type || JSON.stringify(json.error);
  }

  NS.providers = {
    PROTOCOLS: PROTOCOLS,
    AUTH_TYPES: AUTH_TYPES,
    PROVIDER_GROUPS: PROVIDER_GROUPS,
    PROVIDERS: PROVIDERS,
    DEFAULT_PROVIDER_ID: DEFAULT_PROVIDER_ID,
    getProvider: getProvider,
    getProvidersByGroup: getProvidersByGroup,
    buildEndpoint: buildEndpoint,
    buildStreamEndpoint: buildStreamEndpoint,
    buildHeaders: buildHeaders,
    buildBody: buildBody,
    extractDelta: extractDelta,
    extractText: extractText,
    extractError: extractError,
    setSessionIdProvider: setSessionIdProvider
  };

  // http.js 先于本文件加载，这里绑定会话 ID 生成器
  if (NS.http && NS.http.getSessionId) {
    setSessionIdProvider(NS.http.getSessionId);
  }
})(window);
