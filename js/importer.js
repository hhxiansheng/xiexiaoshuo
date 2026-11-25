/* ============================================================
   importer.js - 设定文件导入
   挂在全局命名空间 NW.importer
   读取一份结构化创作总纲 Markdown，自动完成：
   1. 解析成各设定文件（世界观/金手指/人物/反派/伏笔/卷级总纲…）
   2. 推断作品结构（每卷章数）
   3. 写入作品文件夹
   4. 可选：用 AI 把卷级总纲展开成章级大纲
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  var state = {
    rawText: "",
    fileName: "",
    parsed: null,
    importing: false,
    expanding: false,
    expandProgress: { done: 0, total: 0, current: "" },
    expandLog: []
  };

  var options = {
    writeFiles: true,
    applyMeta: true,
    applyVolumeConfig: true,
    expandChapterOutlines: false,
    expandVolumes: 1
  };

  function getState() { return state; }
  function getOptions() { return options; }

  // ---------- 解析 ----------
  function parseText(text, name) {
    state.rawText = text || "";
    state.fileName = name || "";
    try {
      state.parsed = NS.settingParser.parseSettingDocument(state.rawText);
      return state.parsed;
    } catch (e) {
      state.parsed = null;
      throw e;
    }
  }

  // 读取本地 .md 文件
  function readFromFile(file, onDone, onError) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var p = parseText(String(reader.result || ""), file.name);
        if (onDone) onDone(p);
      } catch (e) {
        if (onError) onError(e);
      }
    };
    reader.onerror = function () { if (onError) onError(reader.error); };
    reader.readAsText(file, "utf-8");
  }

  function reset() {
    state.rawText = "";
    state.fileName = "";
    state.parsed = null;
    state.expanding = false;
    state.expandProgress = { done: 0, total: 0, current: "" };
    state.expandLog = [];
  }

  // ---------- 卷 → 章级大纲 prompt ----------
  function buildVolumeExpandPrompt(vol, ctx) {
    var sys = [
      "你是一位专业的网络小说大纲规划师，擅长把「卷级总纲」展开成「章级详细章纲」。",
      "",
      "【硬性要求】",
      "1. 必须输出第" + vol.start + "章到第" + vol.end + "章的完整章纲，共 " + (vol.end - vol.start + 1) + " 章。",
      "2. 每章一行，格式严格为：第X章 [标题] - [核心事件]",
      "3. 标题必须唯一、有画面感，禁止多章重复标题，禁止使用「继续」「发展」这类空泛词。",
      "4. 核心事件要具体，包含本章推进的剧情、冲突或信息。",
      "5. 严格遵循卷级总纲里给出的「核心事件」和「主要内容」列表，把它们均匀分配到各章。",
      "6. 卷末章节要落到「卷末钩子」上。",
      "7. 禁止输出任何解释、前言、总结，只输出章纲列表。",
      "8. 禁止使用省略号或「以下同理」跳过任何章节。"
    ].join("\n");

    var userParts = [];
    if (ctx.requirement) userParts.push("【作品基本信息】\n" + ctx.requirement.slice(0, 2500));
    if (ctx.worldview) userParts.push("【世界观要点】\n" + ctx.worldview.slice(0, 2000));
    if (ctx.goldenFinger) userParts.push("【核心设定/金手指要遵守的限制】\n" + ctx.goldenFinger.slice(0, 2000));
    userParts.push(
      "【本卷总纲】\n卷名：第" + vol.no + "卷 " + vol.name +
      "\n章节范围：" + vol.start + "-" + vol.end + "章\n\n" + vol.content.slice(0, 3000)
    );
    userParts.push("请输出第" + vol.start + "章到第" + vol.end + "章共 " + (vol.end - vol.start + 1) + " 章的章纲。");

    return {
      system: sys,
      messages: [{ role: "user", content: userParts.join("\n\n") }],
      maxTokens: Math.min(Math.round((vol.end - vol.start + 1) * 220) + 1500, 32000)
    };
  }

  // 从 AI 输出里提取有效章节行
  function extractChapterLines(text, vol) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n")
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return !!l; });

    var out = [];
    var seen = {};

    lines.forEach(function (line) {
      var m = line.match(/第\s*([0-9一二三四五六七八九十百千零〇]+)\s*章\s*[:：、\s]*(.*)$/);
      if (!m) return;
      var no = NS.settingParser.cnNumToInt(m[1]);
      if (!no || no < vol.start || no > vol.end) return;
      if (seen[no]) return;
      seen[no] = true;
      var clean = line.replace(/^[\s\-\*·]+/, "").replace(/^\d+[.、]\s*/, "");
      out.push({ no: no, text: clean });
    });

    out.sort(function (a, b) { return a.no - b.no; });
    return out;
  }

  // ---------- AI 展开卷 → 章级大纲 ----------
  function expandOutlines(volumeCount, callbacks) {
    callbacks = callbacks || {};
    var p = state.parsed;
    if (!p) return Promise.reject(new Error("请先解析设定文件"));

    if (!NS.config.isConfigured()) {
      var err = new Error("请先在设置中填写 API 配置");
      if (callbacks.onError) callbacks.onError(err);
      return Promise.reject(err);
    }

    var vols = p.volumes.slice(0, volumeCount);
    var total = vols.length;
    state.expanding = true;
    state.expandProgress = { done: 0, total: total, current: "" };
    state.expandLog = [];

    var ctx = {
      requirement: p.files["需求确认.md"] || "",
      worldview: p.files["世界观.md"] || "",
      goldenFinger: p.files["金手指.md"] || ""
    };

    var allLines = [];
    var chain = Promise.resolve();

    vols.forEach(function (vol, i) {
      chain = chain.then(function () {
        state.expandProgress = { done: i, total: total, current: "第" + vol.no + "卷 " + vol.name };
        state.expandLog.push("开始：第" + vol.no + "卷 " + vol.name + "（" + vol.start + "-" + vol.end + "章）");
        if (callbacks.onProgress) callbacks.onProgress(state.expandProgress);

        var prompt = buildVolumeExpandPrompt(vol, ctx);
        return NS.ai.chatStream(prompt, function () {}).then(function (full) {
          var chapters = extractChapterLines(full, vol);
          var expect = vol.end - vol.start + 1;
          if (chapters.length < expect) {
            state.expandLog.push("⚠️ 第" + vol.no + "卷 只解析出 " + chapters.length + "/" + expect + " 章");
          } else {
            state.expandLog.push("✅ 第" + vol.no + "卷 完成 " + chapters.length + " 章");
          }
          allLines.push("第" + vol.no + "卷：" + vol.name + "（" + vol.start + "-" + vol.end + "章）");
          chapters.forEach(function (c) { allLines.push("  " + c.text); });
          allLines.push("");
        }).catch(function (e) {
          state.expandLog.push("❌ 第" + vol.no + "卷 失败：" + e.message);
        }).then(function () {
          state.expandProgress = { done: i + 1, total: total, current: "" };
          if (callbacks.onProgress) callbacks.onProgress(state.expandProgress);
        });
      });
    });

    return chain.then(function () {
      var outlineMd = ["# 全书章级大纲", ""].concat(allLines).join("\n").trim();

      var finalOutline = outlineMd;
      if (volumeCount < p.volumes.length) {
        var rest = p.volumes.slice(volumeCount);
        finalOutline += "\n\n<!-- 以下卷尚未展开为章级大纲，可在「设定」页或用「扩展大纲」功能继续生成 -->\n\n";
        rest.forEach(function (v) {
          finalOutline += "第" + v.no + "卷：" + v.name + "（" + v.start + "-" + v.end + "章）\n";
        });
      }

      return NS.fs.writeFile(NS.store.SETTING_DIR, "大纲.md", finalOutline).then(function () {
        NS.store.get().outline = finalOutline;
        state.expandLog.push("");
        state.expandLog.push("✅ 章级大纲已保存为 设定/大纲.md");
        state.expanding = false;
        return finalOutline;
      });
    }).catch(function (e) {
      state.expanding = false;
      throw e;
    });
  }

  // ---------- 执行导入 ----------
  function runImport(onDone, onError) {
    var p = state.parsed;
    if (!p) {
      var e1 = new Error("请先解析设定文件");
      if (onError) onError(e1);
      return Promise.reject(e1);
    }
    if (!NS.fs.getRoot()) {
      var e2 = new Error("请先选择作品文件夹");
      if (onError) onError(e2);
      return Promise.reject(e2);
    }

    state.importing = true;
    var chain = Promise.resolve();

    // 1. 写入各设定文件
    if (options.writeFiles) {
      Object.keys(p.files).forEach(function (name) {
        chain = chain.then(function () {
          return NS.fs.writeFile(NS.store.SETTING_DIR, name, p.files[name]);
        });
      });
      chain = chain.then(function () {
        var req = p.files["需求确认.md"] || "";
        var world = p.files["世界观.md"] || "";
        var gf = p.files["金手指.md"] || "";
        var st = NS.store.get();
        if (req) st.requirement = req;
        if (world) st.worldview = world;
        if (gf) st.goldenFinger = gf;
      });
    }

    // 2. 应用元信息
    if (options.applyMeta) {
      chain = chain.then(function () {
        var m = p.meta;
        var words = NS.settingParser.parseWordCount(m.targetWordsText);
        if (words > 0) {
          NS.store.get().targetWords = words;
          return NS.store.saveTargetWords(words);
        }
      }).then(function () {
        var g = NS.settingParser.guessGenre(p.meta.genreText);
        if (g) {
          NS.store.get().genre = g;
          return NS.store.saveGenre(g);
        }
      });
    }

    // 3. 应用卷结构配置
    if (options.applyVolumeConfig && p.chaptersPerVolume > 0) {
      chain = chain.then(function () {
        NS.store.setChaptersPerVolume(p.chaptersPerVolume);
        var cfg = {
          chaptersPerVolume: p.chaptersPerVolume,
          totalVolumes: p.volumes.length,
          totalChapters: p.volumes.length ? p.volumes[p.volumes.length - 1].end : 0,
          chaptersPerVolumeSource: "imported"
        };
        return NS.fs.writeFile(NS.store.SETTING_DIR, "作品配置.json", JSON.stringify(cfg, null, 2));
      });
    }

    // 4. 写入卷结构清单
    if (p.volumes.length) {
      chain = chain.then(function () {
        var lines = ["# 卷结构清单", "", "| 卷 | 卷名 | 章节区间 | 章数 |", "|---|---|---|---|"];
        p.volumes.forEach(function (v) {
          lines.push("| 第" + v.no + "卷 | " + v.name + " | " + v.start + "-" + v.end + " | " + (v.end - v.start + 1) + " |");
        });
        lines.push("", "共 " + p.volumes.length + " 卷，" + p.volumes[p.volumes.length - 1].end + " 章");
        return NS.fs.writeFile(NS.store.SETTING_DIR, "卷结构.md", lines.join("\n"));
      });
    }

    // 5. 可选：AI 展开章级大纲
    if (options.expandChapterOutlines && p.volumes.length) {
      chain = chain.then(function () {
        return expandOutlines(parseInt(options.expandVolumes, 10) || 1, {});
      });
    }

    chain = chain.then(function () {
      return NS.store.loadAll();
    }).then(function () {
      state.importing = false;
      if (onDone) onDone(true);
      return true;
    }).catch(function (e) {
      state.importing = false;
      if (onError) onError(e);
      throw e;
    });

    return chain;
  }

  NS.importer = {
    getState: getState,
    getOptions: getOptions,
    parseText: parseText,
    readFromFile: readFromFile,
    runImport: runImport,
    expandOutlines: expandOutlines,
    extractChapterLines: extractChapterLines,
    reset: reset
  };
})(window);
