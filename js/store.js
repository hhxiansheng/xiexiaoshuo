/* ============================================================
   store.js - 应用状态 + 文件落盘桥接
   挂在全局命名空间 NW.store
   职责：
   - 内存中保存：当前书名、需求/金手指/大纲/进度
   - 与 NW.fs 协作，把内容写到 SKILL.md 第九章规范的目录
   - 从文件恢复状态（重新打开作品时）
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  var SETTING_DIR = ["设定"];

  var state = {
    bookTitle: "",          // 书名（= 根目录文件夹名）
    requirement: "",        // 需求确认文本
    goldenFinger: "",       // 金手指文本
    worldview: "",          // 世界观文本（可空，默认合并进 requirement）
    outline: "",            // 大纲全文
    targetWords: 0,         // 目标总字数（用户手动设定）
    progress: {             // 进度（SKILL 9.3）
      finishedChapter: 0,
      currentVolume: 1,
      totalWords: 0
    }
  };

  function reset() {
    state.bookTitle = "";
    state.requirement = "";
    state.goldenFinger = "";
    state.worldview = "";
    state.outline = "";
    state.targetWords = 0;
    state.progress = { finishedChapter: 0, currentVolume: 1, totalWords: 0 };
  }

  function get() { return state; }

  // ---------------- 文件名/路径 规范（SKILL 第九章）----------------
  // 章节号 → 中文数字文件名前缀，如 1→一, 12→十二
  function toChineseNum(n) {
    var digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (n <= 0) return String(n);
    if (n < 10) return digits[n];
    if (n < 20) return "十" + (n % 10 === 0 ? "" : digits[n % 10]);
    if (n < 100) {
      var t = digits[Math.floor(n / 10)] + "十" + (n % 10 === 0 ? "" : digits[n % 10]);
      return t;
    }
    return String(n); // 100+ 直接用数字
  }

  // 从大纲行解析章节：兼容多种 AI 输出格式
  // 只要一行里含"第X章"即识别为章节行，容忍数字/中文数字、各种分隔符、列表符号
  function parseOutlineChapters(outlineText) {
    if (!outlineText) return [];
    var lines = outlineText.split("\n");
    var result = [];
    var currentVolume = "";
    lines.forEach(function (line) {
      var raw = line.replace(/^\s+/, "");           // 去行首缩进
      if (!raw) return;

      // 卷行（含"第X卷"且不含"章"）
      var vm = raw.match(/第([0-9一二三四五六七八九十百零]+)卷/);
      if (vm && !/章/.test(raw)) {
        // 去掉 markdown 前缀和章节数括号，提取卷名
        var vname = raw
          .replace(/^[*#\-\s]*/, "")
          .replace(/第[0-9一二三四五六七八九十百零]+卷\s*[:：、]?\s*/, "")
          .replace(/[（(].*$/, "")
          .replace(/[\[\]【】""''《》]/g, "")
          .trim();
        currentVolume = vname;
        return;
      }

      // 章节行（含"第X章"）
      var cm = raw.match(/第([0-9一二三四五六七八九十百零]+)章\s*[:：、\s]?\s*(.*)$/);
      if (cm) {
        var rest = cm[2].trim();
        var title = "", detail = rest;
        // 尝试把"标题 - 详情" / "标题：详情" / "标题 | 详情"拆开
        var m2 = rest.match(/^(.*?)\s*[-—|·：:]\s*(.+)$/);
        if (m2 && m2[1] && m2[1].length <= 30) {
          title = m2[1];
          detail = m2[2];
        }
        // 剥离标题外层可能的中英文括号/引号
        title = title.replace(/^[\[\]【】""''《》\s]+/, "").replace(/[\[\]【】""''《》\s]+$/, "").trim();
        result.push({
          num: cnToArab(cm[1]),
          title: title,
          volume: currentVolume,
          detail: detail
        });
      }
    });
    return result;
  }

  // 中文数字→阿拉伯
  function cnToArab(s) {
    if (s == null) return 0;
    s = String(s).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var map = { "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
                "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
    // 单字：直接查表
    if (s.length === 1) return map[s] != null ? map[s] : 0;
    // 十X
    if (/^十./.test(s)) return 10 + (map[s[1]] || 0);
    // X十
    if (/十$/.test(s)) return (map[s[0]] || 0) * 10;
    // X十Y
    if (s.length === 3 && s[1] === "十") return (map[s[0]] || 0) * 10 + (map[s[2]] || 0);
    return parseInt(s, 10) || 0;
  }

  // 章节号 → 所属卷目录名 "第一卷-[卷名](1-10章)"
  function volumeDirForChapter(chNo, outlineText) {
    var vols = parseOutlineChapters(outlineText);
    var ch;
    for (var i = 0; i < vols.length; i++) {
      if (vols[i].num === chNo) { ch = vols[i]; break; }
    }
    var volName = ch && ch.volume ? ch.volume : "默认";
    var volIndex = ch ? Math.ceil(chNo / 10) : Math.ceil(chNo / 10);
    var start = (volIndex - 1) * 10 + 1;
    var end = volIndex * 10;
    return "第" + toChineseNum(volIndex) + "卷-[" + volName + "](" + start + "-" + end + "章)";
  }

  // 章节文件名 "第N章-[标题].md"
  function chapterFileName(chNo, title) {
    return "第" + toChineseNum(chNo) + "章-[" + (title || "未命名") + "].md";
  }

  // ---------------- 写入 ----------------
  function saveRequirement(text) {
    state.requirement = text;
    return NW.fs.writeFile(SETTING_DIR, "需求确认.md", text);
  }
  function saveGoldenFinger(text) {
    state.goldenFinger = text;
    return NW.fs.writeFile(SETTING_DIR, "金手指.md", text);
  }
  function saveOutline(text) {
    state.outline = text;
    return NW.fs.writeFile(SETTING_DIR, "大纲.md", text);
  }
  function saveWorldview(text) {
    state.worldview = text;
    return NW.fs.writeFile(SETTING_DIR, "世界观.md", text || "");
  }
  function saveTargetWords(n) {
    state.targetWords = n;
    return NW.fs.writeFile(SETTING_DIR, "目标字数.txt", String(n));
  }
  function saveProgress() {
    var md = [
      "# 写作进度",
      "",
      "## 当前状态",
      "- 已完成：第" + state.progress.finishedChapter + "章",
      "- 当前卷：第" + state.progress.currentVolume + "卷",
      "- 总字数：约" + Math.round(state.progress.totalWords / 10000) + "万字（" + state.progress.totalWords + "字）",
      "",
      "## 下一步",
      "- 继续创作第" + (state.progress.finishedChapter + 1) + "章",
      "",
      "_由网络小说 AI 写作网站自动生成_"
    ].join("\n");
    return NW.fs.writeFile([], "进度.md", md);
  }

  // 写一章正文；返回保存后的正文
  function saveChapter(chNo, title, content, opts) {
    opts = opts || {};
    var volDir = volumeDirForChapter(chNo, state.outline);
    var fname = chapterFileName(chNo, title);
    // 卷目录在根下（不在设定里）
    return NW.fs.writeFile([volDir], fname, content).then(function () {
      // 更新进度
      if (opts.isNew !== false && chNo > state.progress.finishedChapter) {
        state.progress.finishedChapter = chNo;
        state.progress.currentVolume = Math.ceil(chNo / 10);
      }
      // 重新扫描获取准确总字数（直接累加会导致每次保存都重复计入）
      return recomputeProgress().then(function () { return content; });
    });
  }

  // ---------------- 读取/恢复 ----------------
  function loadAll() {
    var root = NW.fs.getRoot();
    if (!root) return Promise.resolve(null);
    state.bookTitle = root.name;
    return Promise.all([
      NW.fs.readFile(SETTING_DIR, "需求确认.md"),
      NW.fs.readFile(SETTING_DIR, "金手指.md"),
      NW.fs.readFile(SETTING_DIR, "世界观.md"),
      NW.fs.readFile(SETTING_DIR, "大纲.md"),
      NW.fs.readFile(SETTING_DIR, "目标字数.txt")
    ]).then(function (arr) {
      state.requirement = arr[0] || "";
      state.goldenFinger = arr[1] || "";
      state.worldview = arr[2] || "";
      state.outline = arr[3] || "";
      state.targetWords = parseInt(arr[4], 10) || 0;
      // 从已存在章节统计进度
      return recomputeProgress();
    }).then(function () {
      return state;
    });
  }

  // 扫描所有卷目录，统计已完成章数和总字数
  function recomputeProgress() {
    return NW.fs.listDir([]).then(function (entries) {
      var volDirs = entries.filter(function (e) { return e.kind === "directory" && /卷/.test(e.name); });
      var allFiles = [];
      var chain = Promise.resolve();
      volDirs.forEach(function (vd) {
        chain = chain.then(function () {
          return NW.fs.listDir([vd.name]).then(function (files) {
            files.forEach(function (f) { allFiles.push({ vol: vd.name, name: f.name, handle: f.handle }); });
          });
        });
      });
      return chain.then(function () {
        var chapters = allFiles.filter(function (f) { return /章.*\.md$/.test(f.name); });
        var maxCh = 0;
        var totalW = 0;
        var readChain = Promise.resolve();
        chapters.forEach(function (f) {
          readChain = readChain.then(function () {
            return f.handle.getFile().then(function (file) { return file.text(); });
          }).then(function (txt) {
            var m = f.name.match(/第([一二三四五六七八九十百零\d]+)章/);
            if (m) {
              var n = cnToArab(m[1]);
              if (n > maxCh) maxCh = n;
            }
            totalW += NW.prompts.countChars(txt);
          });
        });
        return readChain.then(function () {
          state.progress.finishedChapter = maxCh;
          state.progress.currentVolume = Math.ceil((maxCh || 1) / 10);
          state.progress.totalWords = totalW;
          return state;
        });
      });
    });
  }

  // ---------------- 目录树（供侧边栏）----------------
  function buildTree() {
    var tree = { dirs: [], title: state.bookTitle };
    return NW.fs.listDir([]).then(function (entries) {
      var chain = Promise.resolve();
      entries.forEach(function (e) {
        if (e.kind === "directory") {
          var node = { name: e.name, files: [] };
          tree.dirs.push(node);
          chain = chain.then(function () {
            return NW.fs.listDir([e.name]).then(function (files) {
              files.forEach(function (f) { node.files.push(f.name); });
            });
          });
        } else if (/\.md$/.test(e.name)) {
          // 根目录的 md（如 进度.md）
          if (!tree.rootFiles) tree.rootFiles = [];
          tree.rootFiles.push(e.name);
        }
      });
      return chain.then(function () { return tree; });
    });
  }

  // 读单章
  function readChapter(volDir, fileName) {
    return NW.fs.readFile([volDir], fileName);
  }

  NS.store = {
    SETTING_DIR: SETTING_DIR,
    state: state,
    get: get,
    reset: reset,
    toChineseNum: toChineseNum,
    cnToArab: cnToArab,
    parseOutlineChapters: parseOutlineChapters,
    volumeDirForChapter: volumeDirForChapter,
    chapterFileName: chapterFileName,
    saveRequirement: saveRequirement,
    saveGoldenFinger: saveGoldenFinger,
    saveOutline: saveOutline,
    saveWorldview: saveWorldview,
    saveTargetWords: saveTargetWords,
    saveProgress: saveProgress,
    saveChapter: saveChapter,
    loadAll: loadAll,
    recomputeProgress: recomputeProgress,
    buildTree: buildTree,
    readChapter: readChapter
  };
})(window);
