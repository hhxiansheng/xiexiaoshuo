/* ============================================================
   setting-parser.js - 小说设定文件解析器
   挂在全局命名空间 NW.settingParser
   把一份结构化的创作总纲 Markdown 解析成可导入的各个设定部分。

   支持的文档结构（通用，不绑定具体作品）：
     # 一、小说基本信息      → 书名/类型/字数等 + 元信息表
     # 二、核心世界观        → 世界观
     # 三、主角人物设定      → 人物设定
     # 五、金手指系统：xxx   → 金手指
     # 六、反派体系          → 反派体系
     # 八、三层伏笔系统      → 伏笔清单
     # 九、全书总纲          → 卷结构 + 大纲
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  // ---------- 中文数字 → 阿拉伯数字（支持到 9999）----------
  var CN_DIGITS = {
    "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9
  };
  var CN_UNITS = { "十": 10, "百": 100, "千": 1000 };

  function cnNumToInt(input) {
    if (input == null) return 0;
    // 去掉常见单位/标点：「500章」「20卷」「约3000字」
    var s = String(input).trim().replace(/[章卷字万约\s,，.。]/g, "");
    if (!s) return 0;
    if (/^\d+$/.test(s)) return parseInt(s, 10);

    var total = 0, section = 0, number = 0, hasUnit = false;

    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (CN_DIGITS.hasOwnProperty(ch)) {
        number = CN_DIGITS[ch];
      } else if (CN_UNITS.hasOwnProperty(ch)) {
        hasUnit = true;
        var unit = CN_UNITS[ch];
        if (number === 0 && unit === 10) number = 1; // 「十一」的「十」
        section += number * unit;
        number = 0;
      } else if (ch === "万") {
        section += number;
        total += section * 10000;
        section = 0;
        number = 0;
      }
    }
    section += number;

    if (!hasUnit && total === 0) {
      // 纯数字字符但长度>1（如"九九"），当作拼接
      var r = 0;
      for (var j = 0; j < s.length; j++) {
        if (CN_DIGITS.hasOwnProperty(s[j])) r = r * 10 + CN_DIGITS[s[j]];
      }
      if (r > 0) return r;
    }
    return total + section;
  }

  // ---------- 按 Markdown 标题切分 ----------
  function sliceByHeadings(md) {
    // 统一换行符：Windows 的 CRLF 会让行尾残留 \r，导致 $ 锚点匹配失败
    var lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    var nodes = [];
    var inFence = false;

    lines.forEach(function (line, i) {
      if (/^```/.test(line.trim())) inFence = !inFence;
      if (inFence) return;
      var m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) nodes.push({ level: m[1].length, rawTitle: m[2].trim(), line: i });
    });

    return nodes.map(function (node, idx) {
      var end = lines.length;
      for (var j = idx + 1; j < nodes.length; j++) {
        if (nodes[j].level <= node.level) { end = nodes[j].line; break; }
      }
      return {
        level: node.level,
        rawTitle: node.rawTitle,
        title: stripHeadingNo(node.rawTitle),
        content: lines.slice(node.line + 1, end).join("\n").trim(),
        startLine: node.line + 1,
        endLine: end
      };
    });
  }

  // 去掉标题里的中文序号前缀：「一、小说基本信息」→「小说基本信息」
  function stripHeadingNo(s) {
    return String(s || "").replace(/^[一二三四五六七八九十百千零〇\d]+[、.．]\s*/, "").trim();
  }

  // ---------- 从标题里判断分类 ----------
  var SECTION_RULES = [
    { key: "basic",        re: /小说基本信息|基本信息|作品信息|书籍信息/ },
    { key: "requirement",  re: /需求|创作需求|故事梗概/ },
    { key: "worldview",    re: /世界观|世界设定|核心世界观|世界地图|地图系统/ },
    { key: "goldenfinger", re: /金手指|核心能力|特殊能力|系统设定/ },
    { key: "characters",   re: /人物|角色|主角设定|人物设定/ },
    { key: "villains",     re: /反派|敌对|对手/ },
    { key: "foreshadow",   re: /伏笔|线索|悬念/ },
    { key: "outline",      re: /总纲|大纲|卷结构|全书结构|章节规划/ },
    { key: "ending",       re: /结局|反转|终章/ },
    { key: "rhythm",       re: /节奏|爽点|情绪曲线/ },
    { key: "quality",      re: /质量控制|一致性|检查|禁止/ },
    { key: "plotlines",    re: /剧情线|主线|感情线|支线/ }
  ];

  function classifySection(title) {
    var t = stripHeadingNo(title);
    for (var i = 0; i < SECTION_RULES.length; i++) {
      if (SECTION_RULES[i].re.test(t)) return SECTION_RULES[i].key;
    }
    return null;
  }

  // ---------- 解析「一、小说基本信息」里的表格 ----------
  function parseInfoTable(md) {
    var info = {};
    var lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!/^\|/.test(trimmed)) continue;
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue; // 分隔行

      var cells = trimmed.split("|").slice(1, -1).map(function (c) { return c.trim(); });
      if (cells.length < 2) continue;

      var k = cells[0], v = cells[1];
      if (!k || !v) continue;
      // 首行表头跳过
      if (/^(项目|字段|名称)$/.test(k) && /^(设定|内容|说明)$/.test(v)) continue;
      info[k] = v;
    }
    return info;
  }

  function extractMeta(info) {
    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        if (info[arguments[i]]) return info[arguments[i]];
      }
      return "";
    }
    return {
      bookTitle:           pick("书名", "作品名", "名称"),
      genreText:           pick("小说类型", "类型", "题材"),
      targetWordsText:     pick("目标字数", "字数"),
      totalChaptersText:   pick("总章节", "总章数", "章节数"),
      totalVolumesText:    pick("总卷数", "卷数"),
      chaptersPerVolumeText: pick("每卷章数", "单卷章数"),
      wordsPerChapterText: pick("每章字数", "单章字数"),
      protagonist:         pick("主角", "主人公"),
      goldenFingerName:    pick("核心金手指", "金手指"),
      theme:               pick("核心主题", "主题"),
      style:               pick("叙事风格", "风格"),
      ending:              pick("结局类型", "结局")
    };
  }

  // 解析「150万字」→ 1500000
  function parseWordCount(text) {
    if (!text) return 0;
    var s = String(text).replace(/[,，\s]/g, "");
    var m = s.match(/(\d+(?:\.\d+)?)\s*万字/);
    if (m) return Math.round(parseFloat(m[1]) * 10000);
    var m2 = s.match(/(\d+(?:\.\d+)?)\s*字/);
    if (m2) return Math.round(parseFloat(m2[1]));
    return 0;
  }

  // 解析章节区间文本
  function parseChapterRange(text) {
    if (!text) return null;
    var s = String(text);
    var m = s.match(/第?\s*([0-9一二三四五六七八九十百千零〇]+)\s*[—\-~－～至到]\s*([0-9一二三四五六七八九十百千零〇]+)\s*章?/);
    if (!m) {
      var single = s.match(/第\s*([0-9一二三四五六七八九十百千零〇]+)\s*章/);
      if (single) {
        var n = cnNumToInt(single[1]);
        return n ? { start: n, end: n } : null;
      }
      return null;
    }
    var start = cnNumToInt(m[1]);
    var end = cnNumToInt(m[2]);
    if (!start || !end) return null;
    return { start: start, end: end };
  }

  // ---------- 解析卷结构 ----------
  function parseVolumes(md) {
    var nodes = sliceByHeadings(md);
    var vols = [];

    // 优先只认「卷」后面跟着卷名的标题
    var volRe = /第\s*([0-9一二三四五六七八九十百千零〇]+)\s*卷\s*[：:、·.\-—\s]\s*(.+)$/;

    nodes.forEach(function (node) {
      var raw = node.rawTitle.trim();
      var m = raw.match(volRe);
      if (!m) return;

      var volNo = cnNumToInt(m[1]);
      if (!volNo) return;

      var rest = (m[2] || "").trim();
      if (!rest) return;

      var range = parseChapterRange(rest);
      var isOutlineContainer = node.level > 2;

      // 排除「第一卷详细设计」这类执行计划用词
      if (!range) {
        if (/详细设计|章纲|创作|执行|计划|检查|阶段/.test(rest)) return;
        if (isOutlineContainer) return;
      }

      var name = rest
        .replace(/[（(][^）)]*[）)]/g, "")
        .replace(/[:：、\s]+$/, "")
        .trim();

      vols.push({
        no: volNo,
        name: name || ("第" + volNo + "卷"),
        start: range ? range.start : null,
        end: range ? range.end : null,
        level: node.level,
        content: node.content
      });
    });

    // 同一卷号可能被多处提及，保留信息最完整的那条
    var byNo = {};
    vols.forEach(function (v) {
      var prev = byNo[v.no];
      if (!prev) { byNo[v.no] = v; return; }
      function score(x) {
        return (x.start != null && x.end != null ? 100 : 0) +
               (x.level === 3 ? 10 : x.level === 2 ? 5 : 0) +
               (x.content ? x.content.length / 1000 : 0);
      }
      if (score(v) > score(prev)) byNo[v.no] = v;
    });

    var result = Object.keys(byNo).map(function (k) { return byNo[k]; })
      .sort(function (a, b) { return a.no - b.no; });

    // 补齐缺失的起止章号
    var cursor = 1;
    result.forEach(function (v, i) {
      if (v.start != null && v.end != null) { cursor = v.end + 1; return; }
      var next = null;
      for (var j = i + 1; j < result.length; j++) {
        if (result[j].start != null) { next = result[j]; break; }
      }
      var per = 0;
      if (next && next.start != null) {
        per = Math.max(1, Math.round((next.start - cursor) / (next.no - v.no)));
      } else {
        var prev = null;
        for (var k = i - 1; k >= 0; k--) {
          if (result[k].start != null && result[k].end != null) { prev = result[k]; break; }
        }
        per = prev ? (prev.end - prev.start + 1) : 10;
      }
      v.start = cursor;
      v.end = cursor + per - 1;
      cursor = v.end + 1;
    });

    return result;
  }

  // 从卷结构推断每卷章数（取众数）
  function inferChaptersPerVolume(vols) {
    if (!vols || !vols.length) return 0;
    var counts = {};
    vols.forEach(function (v) {
      if (v.start != null && v.end != null) {
        var n = v.end - v.start + 1;
        if (n > 0) counts[n] = (counts[n] || 0) + 1;
      }
    });
    var best = 0, bestCount = -1;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestCount) { bestCount = counts[k]; best = parseInt(k, 10); }
    });
    return best;
  }

  // 把切出来的 section 还原成 markdown
  function secToMarkdown(sec) {
    var hashes = new Array(sec.level + 1).join("#");
    return (hashes + " " + sec.rawTitle + "\n\n" + sec.content).trim();
  }

  // ---------- 主解析入口 ----------
  function parseSettingDocument(md) {
    var text = String(md || "").replace(/\r\n?/g, "\n");
    var warnings = [];

    var allNodes = sliceByHeadings(text);
    var firstH1 = null;
    for (var i = 0; i < allNodes.length; i++) {
      if (allNodes[i].level === 1) { firstH1 = allNodes[i]; break; }
    }
    var docTitle = "";
    if (firstH1) {
      docTitle = firstH1.rawTitle.replace(/^[《【\[]|[》】\]]$/g, "").trim();
    }

    var topSections = allNodes.filter(function (n) { return n.level === 1; });

    // 分类各一级章节
    var buckets = {};
    topSections.forEach(function (sec) {
      var key = classifySection(sec.rawTitle);
      if (!key) return;
      var content = secToMarkdown(sec);
      buckets[key] = buckets[key] ? (buckets[key] + "\n\n" + content) : content;
    });

    // 基本信息
    var basicSec = null;
    for (var j = 0; j < topSections.length; j++) {
      if (classifySection(topSections[j].rawTitle) === "basic") { basicSec = topSections[j]; break; }
    }
    var info = basicSec ? parseInfoTable(basicSec.content) : {};
    var meta = extractMeta(info);

    // 卷结构
    var volumes = parseVolumes(text);
    var chaptersPerVolume = inferChaptersPerVolume(volumes);

    if (!volumes.length) {
      warnings.push("未在文件中找到「第X卷：卷名（a—b章）」格式的卷结构，无法自动推断每卷章数");
    }
    if (!info || Object.keys(info).length === 0) {
      warnings.push("未找到「项目 | 设定」形式的基本信息表格");
    }

    // 组装要写盘的文件
    var files = {};
    if (buckets.basic) files["需求确认.md"] = buckets.basic;
    if (buckets.requirement) {
      files["需求确认.md"] = files["需求确认.md"]
        ? (files["需求确认.md"] + "\n\n" + buckets.requirement)
        : buckets.requirement;
    }
    if (buckets.worldview)    files["世界观.md"] = buckets.worldview;
    if (buckets.goldenfinger) files["金手指.md"] = buckets.goldenfinger;
    if (buckets.characters)   files["人物设定.md"] = buckets.characters;
    if (buckets.villains)     files["反派体系.md"] = buckets.villains;
    if (buckets.foreshadow)   files["伏笔清单.md"] = buckets.foreshadow;
    if (buckets.outline)      files["卷级总纲.md"] = buckets.outline;
    if (buckets.ending)       files["结局设计.md"] = buckets.ending;
    if (buckets.rhythm)       files["节奏控制.md"] = buckets.rhythm;
    if (buckets.quality)      files["质量控制.md"] = buckets.quality;
    if (buckets.plotlines)    files["剧情线.md"] = buckets.plotlines;

    return {
      title: docTitle || meta.bookTitle,
      meta: meta,
      sections: topSections.map(function (s) {
        return { title: s.rawTitle, key: classifySection(s.rawTitle) };
      }),
      volumes: volumes,
      chaptersPerVolume: chaptersPerVolume,
      info: info,
      files: files,
      warnings: warnings
    };
  }

  // ---------- 从设定里猜类型 ----------
  function guessGenre(genreText) {
    var t = String(genreText || "");
    if (/言情|恋爱|校园|甜宠|都市情感/.test(t)) return "romance";
    if (/悬疑|推理|诡异|怪谈|恐怖|惊悚|灵异/.test(t)) return "mystery";
    if (/科幻|末世|赛博|星际/.test(t)) return "scifi";
    if (/都市|现实|职场|官场/.test(t)) return "urban";
    if (/玄幻|修仙|仙侠|修真|升级/.test(t)) return "xuanhuan";
    return "xuanhuan";
  }

  NS.settingParser = {
    cnNumToInt: cnNumToInt,
    sliceByHeadings: sliceByHeadings,
    stripHeadingNo: stripHeadingNo,
    classifySection: classifySection,
    parseInfoTable: parseInfoTable,
    extractMeta: extractMeta,
    parseWordCount: parseWordCount,
    parseChapterRange: parseChapterRange,
    parseVolumes: parseVolumes,
    inferChaptersPerVolume: inferChaptersPerVolume,
    parseSettingDocument: parseSettingDocument,
    guessGenre: guessGenre
  };
})(window);
