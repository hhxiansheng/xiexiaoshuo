/* ============================================================
   app.js - UI 编排 + 事件绑定（单页应用入口）
   挂在全局命名空间 NW.app
   依赖：config / fs / ai / prompts / store
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // 流式中断信号
  var currentAbort = null;
  var editorDirty = false;

  function setDirty(val) {
    editorDirty = val;
    var el = $("#saveStatus");
    if (el) el.textContent = val ? "● 未保存" : "📝 已保存";
  }

  // ==================== 工具 ====================
  function toast(msg, type) {
    var wrap = $("#toastWrap");
    var el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 2600);
  }

  function ensureConfigured() {
    if (!NS.config.isConfigured()) {
      toast("请先在右上角设置中填写 API 配置", "err");
      showView("settings");
      return false;
    }
    return true;
  }

  function ensureFolder() {
    if (!NS.fs.getRoot()) {
      toast("请先选择作品文件夹", "err");
      return false;
    }
    return true;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 视图切换
  function showView(name, skipAutoLoad) {
    // 离开编辑器时自动保存未保存的内容
    var curView = $(".view.active");
    if (curView && curView.id === "view-editor" && name !== "editor" && editorDirty) {
      var chNo = parseInt($("#editorChNo").textContent, 10);
      if (chNo && !isNaN(chNo)) {
        var title = $("#editorTitle").value.trim() || ("第" + chNo + "章");
        var content = $("#editorText").value;
        NS.store.saveChapter(chNo, title, content, { isNew: false }).then(function () {
          setDirty(false);
        }).catch(function () {});
      }
    }
    $$(".view").forEach(function (v) { v.classList.remove("active"); });
    var v = $("#view-" + name);
    if (v) v.classList.add("active");
    // 侧边栏高亮
    $$(".sidebar-foot .btn").forEach(function (b) { b.classList.remove("btn-primary"); });
    var navBtn = $('[data-nav="' + name + '"]');
    if (navBtn) navBtn.classList.add("btn-primary");
    // 进入编辑器时自动加载最新章节（writeChapter 等场景跳过）
    if (name === "editor" && !skipAutoLoad) {
      autoLoadLatestChapter();
    }
    // 进入设定中心时加载目标字数
    if (name === "settings-center") {
      loadTargetWordsInput();
    }
  }

  // 自动加载最新章节到编辑器
  function autoLoadLatestChapter() {
    // 编辑器已有内容且章号有效，不覆盖（如刚从向导/续写过来）
    var curNo = parseInt($("#editorChNo").textContent.trim(), 10);
    if (curNo && !isNaN(curNo) && $("#editorText").value.trim()) return;
    if (!NS.fs.getRoot()) return;

    NS.store.buildTree().then(function (tree) {
      var latest = null; // { chNo, volDir, fileName }
      tree.dirs.forEach(function (d) {
        if (d.name === "设定") return;
        d.files.forEach(function (f) {
          if (!/\.md$/i.test(f)) return;
          var m = f.match(/第([0-9一二三四五六七八九十百零]+)章/);
          if (m) {
            var n = NS.store.cnToArab(m[1]);
            if (!latest || n > latest.chNo) {
              latest = { chNo: n, volDir: d.name, fileName: f };
            }
          }
        });
      });
      if (latest) {
        loadChapterToEditor(latest.volDir, latest.fileName);
      }
    }).catch(function (e) {
      log("autoLoadLatestChapter 失败:", e.message || e);
    });
  }

  // ==================== 初始化 ====================
  function init() {
    try {
      NS.config.applyTheme();
      log("init: bindTopbar");
      bindTopbar();
      log("init: bindHome");
      bindHome();
      log("init: bindSettings");
      bindSettings();
      log("init: bindWizard");
      bindWizard();
      log("init: bindEditor");
      bindEditor();
      log("init: bindSettingsCenter");
      bindSettingsCenter();
      log("init: bindCheck");
      bindCheck();
      log("init: 所有 bind 完成");
    } catch (e) {
      console.error("[init] 初始化抛错：", e);
      toast("初始化失败：" + e.message, "err");
    }

    // 尝试恢复上次目录
    NS.fs.restoreDirectory().then(function (h) {
      if (h) {
        // 有缓存句柄，显示恢复提示（权限要重新请求）
        var hint = $("#restoreHint");
        var nameEl = $("#restoreName");
        if (hint) hint.style.display = "";
        if (nameEl) nameEl.textContent = h.name;
        var btn = $("#btnRestore");
        if (btn) btn.style.display = "";
      }
      refreshTopbar();
    }).catch(function (e) {
      console.error("[init] restoreDirectory 失败：", e);
    });

    if (!NS.fs.supported()) {
      toast("当前浏览器不支持文件读写，请用 Chrome/Edge", "err");
    }
  }

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[NW]");
    console.log.apply(console, args);
  }

  function refreshTopbar() {
    var root = NS.fs.getRoot();
    var span = $("#bookName");
    if (root) {
      span.innerHTML = "作品：<b>" + esc(root.name) + "</b>";
    } else {
      span.textContent = "未选择作品";
    }
  }

  // ==================== 顶栏 ====================
  function bindTopbar() {
    $("#themeToggle").addEventListener("click", function () {
      var t = NS.config.getTheme() === "dark" ? "light" : "dark";
      NS.config.setTheme(t);
      $("#themeToggle").textContent = t === "dark" ? "☀️" : "🌙";
    });
    $("#themeToggle").textContent = NS.config.getTheme() === "dark" ? "☀️" : "🌙";

    $("#btnSettings").addEventListener("click", function () { showView("settings"); });
    $("#btnHome").addEventListener("click", function () { showView("home"); });
  }

  // ==================== 首页 ====================
  function bindHome() {
    $("#btnPickFolder").addEventListener("click", function () {
      NS.fs.pickDirectory().then(function (h) {
        toast("已选择文件夹：" + h.name, "ok");
        refreshTopbar();
        return NS.store.loadAll();
      }).then(function (st) {
        refreshTree();
        if (st && (st.outline || st.requirement)) {
          // 已有作品，进编辑器
          showView("editor");
        } else {
          showView("wizard");
        }
      }).catch(function (e) {
        toast("选择失败：" + e.message, "err");
      });
    });

    $("#btnRestore").addEventListener("click", restoreAndLoad);
    var b2 = $("#btnRestore2");
    if (b2) b2.addEventListener("click", restoreAndLoad);

    $("#btnNewBook").addEventListener("click", function () {
      if (!ensureFolder()) return;
      NS.store.reset();
      showView("wizard");
    });
  }

  function restoreAndLoad() {
    var h = NW.fs.getRoot();
    if (!h) { toast("没有可恢复的目录", "err"); return; }
    NS.fs.verifyPermission(h).then(function (ok) {
      if (!ok) { toast("未授权读写权限", "err"); return; }
      var hint = $("#restoreHint");
      if (hint) hint.style.display = "none";
      toast("已恢复访问：" + h.name, "ok");
      return NS.store.loadAll();
    }).then(function (st) {
      if (!st) return;
      refreshTree();
      refreshTopbar();
      showView(st.outline ? "editor" : "wizard");
    }).catch(function (e) { toast("恢复失败：" + e.message, "err"); });
  }

  // 侧边栏导航
  function bindNav() {
    $$("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.nav === "wizard" && !ensureFolder()) return;
        if (b.dataset.nav === "editor" && !ensureFolder()) return;
        if (b.dataset.nav === "settings-center" && !ensureFolder()) return;
        if (b.dataset.nav === "check" && !ensureFolder()) return;
        showView(b.dataset.nav);
        if (b.dataset.nav === "editor") refreshTree();
        if (b.dataset.nav === "check") renderCheckTable();
      });
    });
  }

  // ==================== 设置 ====================
  function bindSettings() {
    var c = NS.config.load();
    $("#cfgBaseUrl").value = c.baseUrl;
    $("#cfgApiKey").value = c.apiKey;
    $("#cfgModel").value = c.model;
    $("#cfgTemp").value = c.temperature;
    $("#cfgPlatform").value = c.platform;

    $("#btnSaveConfig").addEventListener("click", function () {
      NS.config.save({
        baseUrl: $("#cfgBaseUrl").value.trim(),
        apiKey: $("#cfgApiKey").value.trim(),
        model: $("#cfgModel").value.trim(),
        temperature: parseFloat($("#cfgTemp").value) || 0.85,
        platform: $("#cfgPlatform").value
      });
      toast("设置已保存", "ok");
    });

    $("#btnTestConn").addEventListener("click", function () {
      NS.config.save({
        baseUrl: $("#cfgBaseUrl").value.trim(),
        apiKey: $("#cfgApiKey").value.trim(),
        model: $("#cfgModel").value.trim(),
        temperature: parseFloat($("#cfgTemp").value) || 0.85,
        platform: $("#cfgPlatform").value
      });
      var btn = $("#btnTestConn");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 测试中…';
      NS.ai.testConnection().then(function (r) {
        toast("连接成功：" + (r.reply || "OK"), "ok");
      }).catch(function (e) {
        toast("连接失败：" + e.message, "err");
      }).then(function () {
        btn.disabled = false;
        btn.textContent = "测试连接";
      });
    });
  }

  // ==================== 向导 ====================
  var wizardStep = 1;
  var wizardTpl = "A";  // 金手指模板选择

  function bindWizard() {
    // 步骤导航
    $("#wizPrev").addEventListener("click", function () {
      if (wizardStep > 1) { wizardStep--; renderWizardStep(); }
    });
    $("#wizNext").addEventListener("click", function () {
      if (wizardStep < 4) { wizardStep++; renderWizardStep(); }
    });

    // Step1 需求确认
    $("#btnGenReq").addEventListener("click", genRequirement);

    // Step2 模板选择
    $$(".tpl-card").forEach(function (card) {
      card.addEventListener("click", function () {
        $$(".tpl-card").forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        wizardTpl = card.dataset.tpl;
      });
    });
    $("#btnGenGF").addEventListener("click", genGoldenFinger);

    // Step3 大纲
    $("#btnGenOutline").addEventListener("click", genOutline);

    // Step4 写第一章
    populateChapterTypeSelect($("#wizChType"));
    $("#btnGenFirstChapter").addEventListener("click", function () {
      // 先把页面上可能编辑过的大纲/需求/金手指同步进内存
      syncWizardResultsToStore();
      if (!NS.store.get().outline) { toast("请先生成大纲", "err"); return; }
      var chs = NS.store.parseOutlineChapters(NS.store.get().outline);
      if (!chs.length) {
        toast("未能从大纲解析出章节（请检查大纲格式：每行需含『第X章』）", "err");
        console.log("[大纲解析失败] 原文：", NS.store.get().outline);
        return;
      }
      chs.sort(function (a, b) { return a.num - b.num; });
      var ch = chs[0];
      writeChapter(ch, $("#wizChType").value, "");
    });
  }

  // 把向导页三个 contenteditable 框的最新内容同步进 store
  // （用户可能直接在框里编辑过，state 里是旧的）
  function syncWizardResultsToStore() {
    var req = $("#reqResult"), gf = $("#gfResult"), ol = $("#outlineResult");
    if (req && req.textContent.trim()) NS.store.get().requirement = req.textContent;
    if (gf && gf.textContent.trim()) NS.store.get().goldenFinger = gf.textContent;
    if (ol && ol.textContent.trim()) NS.store.get().outline = ol.textContent;
  }

  function renderWizardStep() {
    $$(".step").forEach(function (s, i) {
      s.classList.toggle("active", i + 1 === wizardStep);
      s.classList.toggle("done", i + 1 < wizardStep);
    });
    $$(".wiz-panel").forEach(function (p) { p.style.display = "none"; });
    $("#wizStep" + wizardStep).style.display = "";

    $("#wizPrev").disabled = wizardStep === 1;
    $("#wizNext").disabled = wizardStep === 4;
  }

  // 通用：流式生成到目标元素
  function streamGenerate(promptBuilder, targetEl, opts) {
    opts = opts || {};
    if (!ensureConfigured()) return Promise.reject(new Error("no config"));
    var p = promptBuilder();
    targetEl.classList.add("streaming");
    targetEl.textContent = "";
    targetEl.setAttribute("contenteditable", "false");

    var abortCtrl = new AbortController();
    currentAbort = abortCtrl;

    return NS.ai.chatStream(p, function (delta, full) {
      targetEl.textContent = full;
      targetEl.scrollTop = targetEl.scrollHeight;
    }, abortCtrl.signal).then(function (full) {
      targetEl.classList.remove("streaming");
      currentAbort = null;
      return full;
    }).catch(function (e) {
      targetEl.classList.remove("streaming");
      currentAbort = null;
      if (e.name === "AbortError") {
        toast("已停止", "");
      } else {
        targetEl.textContent = "❌ 生成失败：" + e.message;
      }
      throw e;
    });
  }

  function genRequirement() {
    var req = collectReqForm();
    if (!req.type || !req.protagonist || !req.theme || !req.worldview) {
      toast("请至少填写 类型/主角/主题/世界观", "err"); return;
    }
    var btn = $("#btnGenReq"); setBusy(btn, true);
    var box = $("#reqResult");
    streamGenerate(function () { return NS.prompts.buildRequirementConfirm(req); }, box)
      .then(function (text) {
        NS.store.get().requirement = text;
        return NS.fs.getRoot() ? NS.store.saveRequirement(text) : null;
      })
      .then(function () { toast("需求确认已生成并保存", "ok"); })
      .catch(function () {})
      .then(function () { setBusy(btn, false); });
  }

  function collectReqForm() {
    return {
      type: $("#fType").value.trim(),
      protagonist: $("#fProtagonist").value.trim(),
      theme: $("#fTheme").value.trim(),
      worldview: $("#fWorldview").value.trim(),
      targetWords: $("#fTargetWords").value.trim(),
      special: $("#fSpecial").value.trim()
    };
  }

  function genGoldenFinger() {
    var req = collectReqForm();
    var reqText = NS.store.get().requirement || $("#reqResult").textContent;
    if (!reqText) { toast("请先在步骤1生成需求确认", "err"); return; }
    var btn = $("#btnGenGF"); setBusy(btn, true);
    var box = $("#gfResult");
    streamGenerate(function () {
      return NS.prompts.buildGoldenFinger(req, wizardTpl, reqText);
    }, box)
      .then(function (text) {
        NS.store.get().goldenFinger = text;
        return NS.fs.getRoot() ? NS.store.saveGoldenFinger(text) : null;
      })
      .then(function () { toast("金手指已生成并保存", "ok"); })
      .catch(function () {})
      .then(function () { setBusy(btn, false); });
  }

  function genOutline() {
    var reqText = NS.store.get().requirement || $("#reqResult").textContent;
    var gfText = NS.store.get().goldenFinger || $("#gfResult").textContent;
    if (!reqText || !gfText) { toast("请先完成步骤1、2", "err"); return; }
    var chCount = parseInt($("#outlineCount").value, 10) || 30;
    var btn = $("#btnGenOutline"); setBusy(btn, true);
    var box = $("#outlineResult");
    streamGenerate(function () {
      return NS.prompts.buildOutline(collectReqForm(), reqText, gfText, chCount);
    }, box)
      .then(function (text) {
        NS.store.get().outline = text;
        return NS.fs.getRoot() ? NS.store.saveOutline(text) : null;
      })
      .then(function () { toast("大纲已生成并保存", "ok"); })
      .catch(function () {})
      .then(function () { setBusy(btn, false); });
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      btn.dataset.orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 生成中…';
    } else {
      btn.disabled = false;
      if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    }
  }

  // ==================== 章节写作（向导 step4 + 编辑器续写共用）====================
  function populateChapterTypeSelect(sel) {
    if (!sel) return;
    sel.innerHTML = "";
    Object.keys(NS.prompts.CHAPTER_TYPES).forEach(function (k) {
      var t = NS.prompts.CHAPTER_TYPES[k];
      var o = document.createElement("option");
      o.value = k;
      o.textContent = t.name + "（" + t.min + "-" + t.max + "字）" + t.desc;
      sel.appendChild(o);
    });
  }

  // 写一章并保存。prevEnding 为上一章结尾文本（可空）
  function writeChapter(ch, chapterType, prevEnding) {
    if (!ensureConfigured()) return;
    var st = NS.store.get();
    var prompt = NS.prompts.buildChapter({
      requirementConfirm: st.requirement,
      goldenFinger: st.goldenFinger,
      outline: st.outline,
      chapterNo: ch.num,
      chapterType: chapterType,
      platform: NS.config.get("platform"),
      thisChapterOutlineLine: "第" + NS.store.toChineseNum(ch.num) + "章 " + (ch.title ? "[" + ch.title + "]" : "") + " - " + ch.detail,
      prevChapterEnding: prevEnding
    });

    // 切到编辑器视图显示流式输出（跳过自动加载，正在写当前章）
    showView("editor", true);
    var ta = $("#editorText");
    var titleInput = $("#editorTitle");
    titleInput.value = ch.title || ("第" + ch.num + "章");
    $("#editorChNo").textContent = ch.num;
    $("#editorVol").textContent = NS.store.volumeDirForChapter(ch.num, st.outline);
    ta.value = "";
    ta.placeholder = "AI 正在写作中…";

    var btns = $$("#editorToolbar .btn");
    btns.forEach(function (b) { b.disabled = true; });

    var abortCtrl = new AbortController();
    currentAbort = abortCtrl;
    var full = "";
    var rafPending = false;
    NS.ai.chatStream(prompt, function (delta, f) {
      full = f;
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(function () {
          ta.value = full;
          updateWordCount();
          ta.scrollTop = ta.scrollHeight;
          rafPending = false;
        });
      }
    }, abortCtrl.signal).then(function (f) {
      full = f;
      // 确保最终文本完整渲染
      ta.value = full;
      updateWordCount();
      ta.scrollTop = ta.scrollHeight;
      // 自动保存
      var title = extractTitle(f, ch);
      titleInput.value = title;
      return NS.store.saveChapter(ch.num, title, f, { isNew: true }).then(function () {
        setDirty(false);
        toast("第" + ch.num + "章已生成并保存", "ok");
        refreshTree();
        refreshTopbar();
      });
    }).catch(function (e) {
      if (e.name !== "AbortError") toast("生成失败：" + e.message, "err");
    }).then(function () {
      btns.forEach(function (b) { b.disabled = false; });
      currentAbort = null;
      updateWordCount();
      updateNextChapterBtn();
      autoSelectChapterType(ch.num + 1);
    });
  }

  // 从生成的正文里提取标题（第一行 # 第X章 标题）
  function extractTitle(text, ch) {
    var m = text.match(/^#\s*第[一二三四五六七八九十百零\d]+章\s*(.+)/m);
    if (m) return m[1].replace(/[\[\]【】]/g, "").trim();
    return ch.title || ("第" + ch.num + "章");
  }

  // 去掉正文里的标题行，便于编辑
  function stripTitleLine(text) {
    return text.replace(/^#\s*第[一二三四五六七八九十百零\d]+章[^\n]*\n+/, "");
  }

  // ==================== 整卷批量生成 ====================
  function generateVolume() {
    var st = NS.store.get();

    // 扫描所有章节，找到最高章号
    NS.store.buildTree().then(function (tree) {
      var maxChNo = 0;
      var allExisting = {};  // { chNo: true }
      var volMap = {};       // { volIndex: { dirName, files } }

      tree.dirs.forEach(function (d) {
        if (d.name === "设定") return;
        var vm = d.name.match(/第([0-9一二三四五六七八九十百零]+)卷/);
        var vi = vm ? NS.store.cnToArab(vm[1]) : 0;
        if (vi) volMap[vi] = { dirName: d.name, files: d.files };
        d.files.forEach(function (f) {
          if (!/\.md$/i.test(f)) return;
          var m = f.match(/第([0-9一二三四五六七八九十百零]+)章/);
          if (m) {
            var n = NS.store.cnToArab(m[1]);
            allExisting[n] = true;
            if (n > maxChNo) maxChNo = n;
          }
        });
      });

      // 决定生成哪一卷
      var volIndex;
      if (maxChNo === 0) {
        // 没有任何章节，从第一卷开始
        volIndex = 1;
      } else {
        // 检查最高章号所在卷是否有缺章
        var curVol = Math.ceil(maxChNo / 10);
        var curVolMissing = 0;
        for (var c = (curVol - 1) * 10 + 1; c <= curVol * 10; c++) {
          if (!allExisting[c]) curVolMissing++;
        }
        if (curVolMissing > 0) {
          // 当前卷有缺章，补当前卷
          volIndex = curVol;
        } else {
          // 当前卷已满，写下一卷
          volIndex = curVol + 1;
        }
      }

      var startCh = (volIndex - 1) * 10 + 1;
      var endCh = volIndex * 10;

      // 解析该卷已有章号（需要读取文件验证有实际内容）
      var volDirName = volMap[volIndex] ? volMap[volIndex].dirName : "";
      var volFiles = volMap[volIndex] ? volMap[volIndex].files : [];
      var candidateChapters = {};  // { chNo: fileName }

      volFiles.forEach(function (f) {
        if (!/\.md$/i.test(f)) return;
        var m = f.match(/第([0-9一二三四五六七八九十百零]+)章/);
        if (m) {
          var n = NS.store.cnToArab(m[1]);
          if (n >= startCh && n <= endCh) {
            candidateChapters[n] = f;
          }
        }
      });

      // 逐一读取候选章节文件，验证有实际内容（>100字）
      var verifyChain = Object.keys(candidateChapters).reduce(function (chain, chNoStr) {
        var chNo = parseInt(chNoStr, 10);
        var fname = candidateChapters[chNo];
        return chain.then(function (verified) {
          return NS.store.readChapter(volDirName, fname).then(function (text) {
            if (text && text.length > 100) {
              verified[chNo] = true;
            }
            return verified;
          }).catch(function () {
            return verified;
          });
        });
      }, Promise.resolve({}));

      verifyChain.then(function (existingChapters) {

      // 解析大纲中的章节列表
      var chs = NS.store.parseOutlineChapters(st.outline || "");
      var outlineChNos = {};
      chs.forEach(function (c) { outlineChNos[c.num] = true; });

      // 需要生成的章节列表（必须有大纲条目才生成）
      var toGenerate = [];
      for (var i = startCh; i <= endCh; i++) {
        if (!existingChapters[i] && outlineChNos[i]) toGenerate.push(i);
      }

      if (!toGenerate.length) {
        var hasOutline = false;
        for (var i = startCh; i <= endCh; i++) {
          if (outlineChNos[i]) { hasOutline = true; break; }
        }
        if (hasOutline) {
          toast("第" + volIndex + "卷（" + startCh + "-" + endCh + "章）已全部存在", "");
        } else {
          toast("大纲中没有第" + volIndex + "卷的章节条目", "");
          showOutlineExhaustedDialog(startCh);
        }
        return;
      }

      var volLabel = "第" + NS.store.toChineseNum(volIndex) + "卷";
      if (!confirm("将生成" + volLabel + "中缺失的 " + toGenerate.length + " 章：\n第" + toGenerate.join("、") + "章\n\n已有的章节不会被覆盖。确定开始？")) return;

      // 显示进度条
      var progressWrap = $("#volumeProgress");
      var progressBar = $("#volumeProgressBar");
      var progressText = $("#volumeProgressText");
      progressWrap.style.display = "";
      progressBar.style.width = "0%";

      var abortCtrl = new AbortController();
      currentAbort = abortCtrl;
      var prevEnding = "";
      var done = 0;

      // 尝试读取 startCh-1 章的结尾作为首章上下文
      var initPromise = Promise.resolve();
      if (startCh > 1) {
        var prevCh = chs.filter(function (c) { return c.num === startCh - 1; })[0];
        if (prevCh) {
          var pVol = NS.store.volumeDirForChapter(startCh - 1, st.outline);
          var pFile = NS.store.chapterFileName(startCh - 1, prevCh.title);
          initPromise = NS.store.readChapter(pVol, pFile).then(function (text) {
            prevEnding = text ? stripTitleLine(text) : "";
          }).catch(function () {});
        }
      }

      initPromise.then(function () {
        // 顺序生成每一章
        var usedTitles = {};
        // 收集已有章节的标题，用于去重
        Object.keys(allExisting).forEach(function (n) {
          var exCh = chs.filter(function (c) { return c.num === parseInt(n, 10); })[0];
          if (exCh && exCh.title) usedTitles[exCh.title] = true;
        });

        return toGenerate.reduce(function (chain, chNo) {
          return chain.then(function () {
            if (abortCtrl.signal.aborted) return;

            progressText.textContent = "正在生成第" + chNo + "章（" + (done + 1) + "/" + toGenerate.length + "）…";

            var ch = chs.filter(function (c) { return c.num === chNo; })[0];
            if (!ch) {
              ch = {
                num: chNo,
                title: "第" + chNo + "章",
                detail: "承接上一章结尾，自然推进剧情，制造新冲突或悬念。参考设定与金手指规则。"
              };
            }

            // 自动选择章节类型
            autoSelectChapterType(chNo);
            var chapterType = $("#editorChType").value || "buildup";

            var prompt = NS.prompts.buildChapter({
              requirementConfirm: st.requirement,
              goldenFinger: st.goldenFinger,
              outline: st.outline,
              chapterNo: ch.num,
              chapterType: chapterType,
              platform: NS.config.get("platform"),
              thisChapterOutlineLine: "第" + NS.store.toChineseNum(ch.num) + "章 " + (ch.title ? "[" + ch.title + "]" : "") + " - " + ch.detail,
              prevChapterEnding: prevEnding
            });

            // 更新编辑器显示当前正在写的章节
            $("#editorChNo").textContent = chNo;
            $("#editorVol").textContent = NS.store.volumeDirForChapter(chNo, st.outline);
            $("#editorTitle").value = ch.title || ("第" + chNo + "章");
            var ta = $("#editorText");
            ta.value = "";
            ta.placeholder = "AI 正在写作第" + chNo + "章…";

            var full = "";
            var rafPending = false;
            return NS.ai.chatStream(prompt, function (delta, f) {
              full = f;
              if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(function () {
                  ta.value = full;
                  updateWordCount();
                  ta.scrollTop = ta.scrollHeight;
                  rafPending = false;
                });
              }
            }, abortCtrl.signal).then(function (f) {
              full = f;
              ta.value = full;
              updateWordCount();
              // 提取标题并去重
              var title = extractTitle(f, ch);
              if (usedTitles[title]) {
                var suffix = 2;
                while (usedTitles[title + suffix]) suffix++;
                title = title + suffix;
              }
              usedTitles[title] = true;
              $("#editorTitle").value = title;
              return NS.store.saveChapter(chNo, title, f, { isNew: true }).then(function () {
                prevEnding = stripTitleLine(f);
                done++;
                progressBar.style.width = Math.round((done / toGenerate.length) * 100) + "%";
                progressText.textContent = "已完成 " + done + "/" + toGenerate.length;
              });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        progressWrap.style.display = "none";
        toast(volLabel + " 生成完成！共 " + done + " 章", "ok");
        currentAbort = null;
        refreshTree();
        updateNextChapterBtn();
        setDirty(false);
        // 自动触发一致性检查
        if (done > 1) {
          toast("正在进行卷内一致性检查…", "");
          runVolumeReview(volIndex, volDirName || NS.store.volumeDirForChapter(startCh, st.outline));
        }
      }).catch(function (e) {
        progressWrap.style.display = "none";
        currentAbort = null;
        if (e.name === "AbortError") {
          toast("已停止（已完成 " + done + " 章）", "");
          refreshTree();
        } else {
          toast("生成中断：" + e.message, "err");
        }
      });
      }); // close verifyChain.then
    });
  }

  // ==================== 大纲扩展 ====================

  // 大纲耗尽时弹窗阻断
  function showOutlineExhaustedDialog(nextCh) {
    var overlay = document.createElement("div");
    overlay.className = "review-overlay";
    var dialog = document.createElement("div");
    dialog.className = "review-dialog";
    dialog.innerHTML = '<h3 style="margin:0 0 12px">⚠️ 大纲已用完</h3>' +
      '<p style="line-height:1.8;color:var(--text-soft)">当前大纲最大章节为 <b>第' + (nextCh - 1) + '章</b>，第' + nextCh + '章没有大纲条目。' +
      '没有大纲指导的章节容易跑偏，请先扩展大纲再继续创作。</p>' +
      '<div style="text-align:right;margin-top:16px;display:flex;gap:10px;justify-content:flex-end">' +
      '<button id="dlgExtend" class="btn btn-primary">📋 扩展大纲</button>' +
      '<button id="dlgCancel" class="btn">取消</button></div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    dialog.querySelector("#dlgCancel").addEventListener("click", function () {
      document.body.removeChild(overlay);
    });
    dialog.querySelector("#dlgExtend").addEventListener("click", function () {
      document.body.removeChild(overlay);
      extendOutline();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
  }

  // 核心：扩展大纲
  function extendOutline() {
    var st = NS.store.get();
    var chs = NS.store.parseOutlineChapters(st.outline || "");
    var maxCh = chs.length ? chs[chs.length - 1].num : 0;

    // 弹出输入章节数
    var countStr = prompt("当前大纲覆盖到第 " + maxCh + " 章。\n请输入要扩展的章节数（建议 30 的倍数）：", "30");
    if (!countStr) return;
    var count = parseInt(countStr, 10);
    if (!count || count < 1) { toast("请输入有效数字", "err"); return; }

    var startCh = maxCh + 1;

    // 显示生成对话框
    var overlay = document.createElement("div");
    overlay.className = "review-overlay";
    var dialog = document.createElement("div");
    dialog.className = "review-dialog";
    dialog.innerHTML = '<h3 style="margin:0 0 12px">📋 扩展大纲（第' + startCh + '-' + (startCh + count - 1) + '章）</h3>' +
      '<div class="review-content" id="extendResult" style="min-height:200px;max-height:60vh">正在读取最近章节…</div>' +
      '<div style="text-align:right;margin-top:12px"><button id="extendClose" class="btn" disabled>关闭</button></div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    var resultBox = dialog.querySelector("#extendResult");
    var closeBtn = dialog.querySelector("#extendClose");
    closeBtn.addEventListener("click", function () {
      document.body.removeChild(overlay);
    });

    // 读取最近 5 章的末尾内容作为剧情上下文
    NS.store.buildTree().then(function (tree) {
      var allFiles = [];
      tree.dirs.forEach(function (d) {
        if (d.name === "设定") return;
        d.files.forEach(function (f) {
          if (!/\.md$/i.test(f)) return;
          var m = f.match(/第([0-9一二三四五六七八九十百零]+)章/);
          if (m) allFiles.push({ chNo: NS.store.cnToArab(m[1]), dir: d.name, file: f });
        });
      });
      allFiles.sort(function (a, b) { return b.chNo - a.chNo; });
      var recent = allFiles.slice(0, 5);
      recent.reverse();

      var readChain = recent.reduce(function (chain, rf) {
        return chain.then(function (texts) {
          return NS.store.readChapter(rf.dir, rf.file).then(function (text) {
            texts.push("【第" + rf.chNo + "章】\n" + NS.prompts.tail(text || "", 800));
            return texts;
          });
        });
      }, Promise.resolve([]));

      return readChain.then(function (recentTexts) {
        resultBox.textContent = "正在生成大纲…";
        var prompt = NS.prompts.buildOutlineExtend({
          requirement: st.requirement,
          goldenFinger: st.goldenFinger,
          existingOutline: st.outline || "",
          recentChapters: recentTexts.join("\n\n---\n\n"),
          startCh: startCh,
          count: count
        });

        var full = "";
        return NS.ai.chatStream(prompt, function (delta, f) {
          full = f;
          resultBox.textContent = full;
          resultBox.scrollTop = resultBox.scrollHeight;
        }).then(function (finalText) {
          full = finalText;
          resultBox.textContent = full;
          // 追加到现有大纲并保存
          var newOutline = (st.outline || "") + "\n\n" + full;
          st.outline = newOutline;
          return NS.store.saveOutline(newOutline).then(function () {
            toast("大纲已扩展 " + count + " 章（第" + startCh + "-" + (startCh + count - 1) + "章）", "ok");
            closeBtn.disabled = false;
            closeBtn.textContent = "✅ 完成，关闭";
            checkOutlineRemaining();
          });
        });
      });
    }).catch(function (e) {
      resultBox.textContent = "扩展失败：" + e.message;
      closeBtn.disabled = false;
    });
  }

  // 大纲剩余提醒
  function checkOutlineRemaining() {
    var st = NS.store.get();
    var chs = NS.store.parseOutlineChapters(st.outline || "");
    if (!chs.length) return;
    var maxCh = chs[chs.length - 1].num;
    var curNo = parseInt($("#editorChNo").textContent.trim(), 10) || 0;
    var remaining = maxCh - curNo;
    var banner = $("#outlineWarning");
    var text = $("#outlineWarningText");
    if (!banner) return;

    if (remaining < 0) {
      text.textContent = "⚠️ 大纲已用完（最大第" + maxCh + "章），请扩展大纲后继续创作。";
      banner.style.display = "";
      banner.className = "outline-warning-banner outline-warning-danger";
    } else if (remaining <= 3) {
      text.textContent = "⚠️ 大纲仅剩 " + remaining + " 章（到第" + maxCh + "章），建议提前扩展。";
      banner.style.display = "";
      banner.className = "outline-warning-banner outline-warning-warn";
    } else {
      banner.style.display = "none";
    }
  }

  // 卷内一致性检查
  function runVolumeReview(volIndex, volDirName) {
    NS.store.buildTree().then(function (tree) {
      // 找到卷目录
      var dir = null;
      tree.dirs.forEach(function (d) {
        if (d.name === volDirName) dir = d;
      });
      if (!dir) { toast("未找到卷目录，跳过检查", ""); return; }

      // 按章号排序读取所有章节
      var files = dir.files.filter(function (f) { return /\.md$/i.test(f); });
      files.sort(function (a, b) {
        var ma = a.match(/第([0-9一二三四五六七八九十百零]+)章/);
        var mb = b.match(/第([0-9一二三四五六七八九十百零]+)章/);
        var na = ma ? NS.store.cnToArab(ma[1]) : 0;
        var nb = mb ? NS.store.cnToArab(mb[1]) : 0;
        return na - nb;
      });

      var readChain = files.reduce(function (chain, f) {
        return chain.then(function (results) {
          return NS.store.readChapter(volDirName, f).then(function (text) {
            var m = f.match(/第([0-9一二三四五六七八九十百零]+)章/);
            var chNo = m ? NS.store.cnToArab(m[1]) : 0;
            var title = f.replace(/\.md$/, "")
              .replace(/第[0-9一二三四五六七八九十百零]+章[-\s]*\[(.*?)\].*/, "$1")
              .replace(/第[0-9一二三四五六七八九十百零]+章[-:\s]*/, "")
              .trim() || f;
            results.push({ chNo: chNo, title: title, text: text || "" });
            return results;
          });
        });
      }, Promise.resolve([]));

      return readChain.then(function (chapterTexts) {
        if (chapterTexts.length < 2) {
          toast("章节不足，跳过一致性检查", "");
          return;
        }

        var prompt = NS.prompts.buildVolumeReview(volDirName, chapterTexts);

        return NS.ai.chat(prompt).then(function (result) {
          // 用自定义弹窗展示结果（alert 对长文本不友好）
          showReviewDialog(volDirName, result, chapterTexts);
        }).catch(function (e) {
          toast("一致性检查失败：" + e.message, "err");
        });
      });
    }).catch(function (e) {
      toast("一致性检查失败：" + e.message, "err");
    });
  }

  // 显示审查结果对话框
  function showReviewDialog(volName, result, chapterTexts) {
    // 创建遮罩层
    var overlay = document.createElement("div");
    overlay.className = "review-overlay";
    var dialog = document.createElement("div");
    dialog.className = "review-dialog";

    var headerHTML = '<h3 style="margin:0 0 12px">📋 ' + esc(volName) + ' 一致性检查</h3>';
    var contentHTML = '<div class="review-content">' + esc(result).replace(/\n/g, '<br>') + '</div>';
    var progressHTML = '<div id="fixProgress" style="display:none;margin-top:12px">' +
      '<div class="progress-bar"><div id="fixProgressBar" class="progress-fill"></div></div>' +
      '<span id="fixProgressText" class="progress-text"></span></div>';
    var hasIssues = /\u26A0\uFE0F?/.test(result);
    var fixBtnHTML = hasIssues
      ? '<button id="fixBtn" class="btn btn-primary">🔧 一键修正</button>'
      : '<button id="fixBtn" class="btn" disabled style="opacity:.6;cursor:default">✅ 无需修正</button>';
    var btnHTML = '<div style="text-align:right;margin-top:16px;display:flex;gap:10px;justify-content:flex-end">' +
      fixBtnHTML +
      '<button id="closeBtn" class="btn">关闭</button></div>';

    dialog.innerHTML = headerHTML + contentHTML + progressHTML + btnHTML;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var closeBtn = dialog.querySelector("#closeBtn");
    var fixBtn = dialog.querySelector("#fixBtn");

    closeBtn.addEventListener("click", function () {
      document.body.removeChild(overlay);
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    fixBtn.addEventListener("click", function () {
      if (!chapterTexts || !chapterTexts.length) {
        toast("没有章节数据，无法修正", "err");
        return;
      }
      if (!confirm("将对 " + chapterTexts.length + " 章逐一修正，修正后会覆盖原文件。\n确定开始？")) return;
      fixBtn.disabled = true;
      fixBtn.textContent = "修正中…";
      runVolumeFix(result, chapterTexts, dialog);
    });
  }

  // 根据审校意见逐章修正
  function runVolumeFix(reviewResult, chapterTexts, dialog) {
    var progressBar = dialog.querySelector("#fixProgressBar");
    var progressText = dialog.querySelector("#fixProgressText");
    var fixProgress = dialog.querySelector("#fixProgress");
    var fixBtn = dialog.querySelector("#fixBtn");

    fixProgress.style.display = "";
    progressBar.style.width = "0%";

    var total = chapterTexts.length;
    var done = 0;
    var fixed = 0;

    chapterTexts.reduce(function (chain, ch) {
      return chain.then(function () {
        progressText.textContent = "修正第" + ch.chNo + "章…（" + done + "/" + total + "）";
        progressBar.style.width = Math.round((done / total) * 100) + "%";

        var prompt = NS.prompts.buildChapterFix(reviewResult, ch);
        return NS.ai.chat(prompt).then(function (fixedText) {
          if (!fixedText || fixedText.length < 200) {
            // AI 返回太短，跳过
            done++;
            return;
          }
          // 找到原文件名
          var st = NS.store.get();
          var volDir = NS.store.volumeDirForChapter(ch.chNo, st.outline);
          var fname = NS.store.chapterFileName(ch.chNo, ch.title);
          return NS.store.saveChapter(ch.chNo, ch.title, fixedText, { isNew: false }).then(function () {
            fixed++;
            done++;
          });
        }).catch(function (e) {
          // 单章修正失败，跳过继续
          done++;
          toast("第" + ch.chNo + "章修正失败：" + e.message, "err");
        });
      });
    }, Promise.resolve()).then(function () {
      progressBar.style.width = "100%";
      progressText.textContent = "修正完成！共修正 " + fixed + " / " + total + " 章";
      fixBtn.textContent = "✅ 修正完成";
      toast("卷内修正完成，修正了 " + fixed + " 章", "");
      // 刷新侧边栏和编辑器
      refreshTree();
    }).catch(function (e) {
      progressText.textContent = "修正中断：" + e.message;
      fixBtn.disabled = false;
      fixBtn.textContent = "🔧 重试修正";
    });
  }

  // ==================== 编辑器 ====================
  function bindEditor() {
    bindNav();
    populateChapterTypeSelect($("#editorChType"));

    $("#editorSave").addEventListener("click", function () {
      var chNo = parseInt($("#editorChNo").textContent, 10);
      if (!chNo) { toast("请先从左侧选择章节或写新章", "err"); return; }
      var title = $("#editorTitle").value.trim() || ("第" + chNo + "章");
      var content = $("#editorText").value;
      NS.store.saveChapter(chNo, title, content, { isNew: false }).then(function () {
        setDirty(false);
        return NS.store.recomputeProgress();
      }).then(function () {
        toast("已保存", "ok");
        refreshTree();
        refreshTopbar();
        checkOutlineRemaining();
      }).catch(function (e) { toast("保存失败：" + e.message, "err"); });
    });

    $("#editorText").addEventListener("input", function () {
      setDirty(true);
      updateWordCount();
    });
    $("#editorTitle").addEventListener("input", function () { setDirty(true); });

    // 续写下一章
    $("#editorNextChapter").addEventListener("click", function () {
      var st = NS.store.get();
      var curNo = parseInt($("#editorChNo").textContent.trim(), 10);
      if (!curNo || isNaN(curNo)) curNo = 1;
      var chs = NS.store.parseOutlineChapters(st.outline || "");
      var nextNo = curNo + 1;
      var next = chs.filter(function (c) { return c.num === nextNo; })[0];
      if (!next) {
        // 大纲已用完，阻断并弹窗
        showOutlineExhaustedDialog(nextNo);
        return;
      }
      var prevEnding = stripTitleLine($("#editorText").value);
      writeChapter(next, $("#editorChType").value, prevEnding);
    });

    // 重写当前章
    $("#editorRewrite").addEventListener("click", function () {
      var st = NS.store.get();
      var chNoRaw = $("#editorChNo").textContent.trim();
      var chNo = parseInt(chNoRaw, 10);
      if (!chNo || isNaN(chNo)) chNo = 1;
      var chs = NS.store.parseOutlineChapters(st.outline || "");
      var ch = chs.filter(function (c) { return c.num === chNo; })[0];
      if (!ch) {
        var curTitle = $("#editorTitle").value.trim();
        var curText = $("#editorText").value;
        ch = {
          num: chNo,
          title: curTitle || ("第" + chNo + "章"),
          detail: NS.prompts.tail(stripTitleLine(curText), 300) || "（无大纲条目，请参考已有正文重写本章节）"
        };
      }
      if (!confirm("重写将覆盖当前内容，确定？")) return;

      // 尝试读取上一章结尾，提升重写连贯性
      if (chNo > 1) {
        var prevCh = chs.filter(function (c) { return c.num === chNo - 1; })[0];
        if (prevCh) {
          var prevVol = NS.store.volumeDirForChapter(chNo - 1, st.outline);
          var prevFile = NS.store.chapterFileName(chNo - 1, prevCh.title);
          NS.store.readChapter(prevVol, prevFile).then(function (text) {
            var prevEnding = text ? stripTitleLine(text) : "";
            writeChapter(ch, $("#editorChType").value, prevEnding);
          }).catch(function () {
            writeChapter(ch, $("#editorChType").value, "");
          });
          return;
        }
      }
      writeChapter(ch, $("#editorChType").value, "");
    });

    // 停止生成
    $("#editorStop").addEventListener("click", function () {
      if (currentAbort) { currentAbort.abort(); toast("已停止", ""); }
    });

    // Ctrl+S / Cmd+S 快捷键保存
    $("#view-editor").addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        $("#editorSave").click();
      }
    });

    // 生成整卷
    $("#editorGenVolume").addEventListener("click", function () {
      if (!ensureConfigured()) return;
      if (!ensureFolder()) return;
      generateVolume();
    });

    // 扩展大纲
    $("#editorExtendOutline").addEventListener("click", function () {
      if (!ensureFolder()) return;
      extendOutline();
    });

    // 大纲警告横幅上的扩展按钮
    var owBtn = $("#outlineWarningBtn");
    if (owBtn) owBtn.addEventListener("click", function () { extendOutline(); });
  }

  function updateWordCount() {
    var text = $("#editorText").value;
    var n = NS.prompts.countChars(text);
    var ct = NS.prompts.CHAPTER_TYPES[$("#editorChType").value];
    $("#wordCount").textContent = n;
    var tip = $("#wordTip");
    if (!ct) { tip.textContent = ""; return; }
    if (n === 0) {
      tip.className = "warn"; tip.textContent = "（空）";
    } else if (n < ct.min) {
      tip.className = "warn"; tip.textContent = "偏少，目标 " + ct.min + "-" + ct.max + " 字";
    } else if (n > ct.max) {
      tip.className = "warn"; tip.textContent = "偏多，目标 " + ct.min + "-" + ct.max + " 字";
    } else {
      tip.className = "ok"; tip.textContent = "字数达标（" + ct.name + "）";
    }
  }

  // 更新「续写下一章」按钮文字，显示下一章章号
  function updateNextChapterBtn() {
    var curNo = parseInt($("#editorChNo").textContent.trim(), 10);
    var btn = $("#editorNextChapter");
    if (!btn) return;
    if (!curNo || isNaN(curNo)) {
      btn.textContent = "⏭️ 续写下一章";
      return;
    }
    var nextNo = curNo + 1;
    btn.textContent = "⏭️ 续写下一章（第" + NS.store.toChineseNum(nextNo) + "章）";
  }

  // 根据大纲关键词 + 章节在卷内的位置，自动选择章节类型
  function autoSelectChapterType(chNo) {
    var sel = $("#editorChType");
    if (!sel) return;
    var st = NS.store.get();
    var chs = NS.store.parseOutlineChapters(st.outline || "");
    var ch = chs.filter(function (c) { return c.num === chNo; })[0];
    // 标题+详情拼一起匹配，覆盖面更大
    var info = ch ? ((ch.title || "") + " " + (ch.detail || "")) : "";

    // 卷内位置（1-10）
    var posInVol = ((chNo - 1) % 10) + 1;

    // 优先用大纲关键词匹配（覆盖面广）
    // 1. 高潮章 — 最明确的类型，先匹配
    if (/决战|高潮|大决战|最终对决|终极|最终战|决战前夕/.test(info)) {
      sel.value = "climax"; return;
    }
    // 2. 战斗章 — 动作场面关键词
    if (/战斗|突破|交手|对决|反杀|搏杀|激战|围攻|追杀|伏击|混战|恶战|血战|厮杀|爆炸|袭击|入侵|突围|对抗|格斗|狙击|进攻|防守|反击|覆灭|毁灭/.test(info)) {
      sel.value = "battle"; return;
    }
    // 3. 情感章 — 内心戏和情感事件
    if (/重逢|真相|揭露|内心|挣扎|告别|牺牲|感动|回忆|誓言|告白|离别|思念|悲伤|痛苦|眼泪|心痛|守护|约定|承诺|牵挂|担忧|恐惧|绝望|希望|温暖|深情|黑暗|黎明|孤独|觉醒|顿悟|震撼|震惊|愤怒|决心/.test(info)) {
      sel.value = "emotion"; return;
    }
    // 4. 收束章 — 只用卷末专属词（"选择""决定""转折"太常见，不放这里）
    if (/卷末|收束|尾声|新篇章|新征程|新旅程|下一卷/.test(info)) {
      sel.value = "wrap"; return;
    }
    // 5. 铺垫章 — 情报收集、策划、修炼等
    if (/情报|计划|布局|谋划|打探|分析|准备|试探|调查|追踪|推理|研究|学习|修炼|训练|实验|策划|密谋|发现|探索|线索|蛛丝马迹/.test(info)) {
      sel.value = "buildup"; return;
    }
    // 6. 过渡章 — 场景切换、日常
    if (/离开|抵达|日常|赶路|休整|返回|搬家|旅行|安顿|休息|采购|逛街|上课|回家/.test(info)) {
      sel.value = "transition"; return;
    }
    // 7. 危机/冲突 — 放在战斗和铺垫之间，避免误判
    if (/危机|冲突/.test(info)) {
      sel.value = "battle"; return;
    }

    // 没有命中关键词，按卷内位置兜底
    if (posInVol === 10) {
      sel.value = "wrap";      // 卷末章 → 收束
    } else if (posInVol === 9) {
      sel.value = "climax";    // 倒数第二章 → 高潮
    } else if (posInVol <= 2) {
      sel.value = "buildup";   // 卷初 → 铺垫（新卷开篇需要铺背景）
    } else if (posInVol <= 5) {
      sel.value = "buildup";   // 前段 → 铺垫
    } else {
      sel.value = "battle";    // 中段偏后 → 战斗
    }
  }

  // 从树点击章节加载到编辑器
  function loadChapterToEditor(volDir, fileName) {
    // 切换章节前，先保存当前未保存的内容
    var savePromise = Promise.resolve();
    if (editorDirty) {
      var curNo = parseInt($("#editorChNo").textContent, 10);
      if (curNo && !isNaN(curNo)) {
        var curTitle = $("#editorTitle").value.trim() || ("第" + curNo + "章");
        var curContent = $("#editorText").value;
        savePromise = NS.store.saveChapter(curNo, curTitle, curContent, { isNew: false }).then(function () {
          setDirty(false);
        }).catch(function () {});
      }
    }
    savePromise.then(function () {
      return NS.store.readChapter(volDir, fileName);
    }).then(function (text) {
      if (text == null) { toast("读取失败", "err"); return; }
      // 兼容多种文件名格式提取章号与标题：
      //   第一章-[重生].md / 第1章-[重生].md / 第一章 重生.md / 第1章 重生.md / 第1章-重生.md
      var chNo = 0, title = fileName.replace(/\.md$/, "");
      var numMatch = fileName.match(/第([0-9一二三四五六七八九十百零]+)章/);
      if (numMatch) chNo = NS.store.cnToArab(numMatch[1]);
      // 标题：去掉"第X章"、扩展名、分隔符、括号
      title = title
        .replace(/第[0-9一二三四五六七八九十百零]+章\s*/, "")
        .replace(/^[-—:\s、]+/, "")
        .replace(/^[\[\]【】""''《》\s]+/, "")
        .replace(/[\[\]【】""''《》\s]+$/, "")
        .trim() || ("第" + chNo + "章");
      $("#editorChNo").textContent = chNo || "?";
      $("#editorVol").textContent = volDir;
      $("#editorTitle").value = title;
      $("#editorText").value = text || "";
      setDirty(false);
      updateWordCount();
      updateNextChapterBtn();
      checkOutlineRemaining();
      autoSelectChapterType(chNo);
      // 高亮侧边栏对应章节，展开所在卷
      var treePath = volDir + "/" + fileName;
      $$("#tree .tree-row").forEach(function (r) { r.classList.remove("active"); });
      var targetRow = $('[data-file="' + treePath + '"]');
      if (targetRow) {
        targetRow.classList.add("active");
        var node = targetRow.closest(".tree-node");
        if (node && node.classList.contains("collapsed")) {
          node.classList.remove("collapsed");
        }
        targetRow.scrollIntoView({ block: "nearest" });
      }
      showView("editor");
    });
  }

  // ==================== 目录树 ====================
  function refreshTree() {
    var treeEl = $("#tree");
    if (!NS.fs.getRoot()) {
      treeEl.innerHTML = '<div class="tree-empty">未选择作品文件夹</div>';
      return;
    }
    NS.store.buildTree().then(function (tree) {
      var html = "";
      if (tree.rootFiles && tree.rootFiles.length) {
        tree.rootFiles.forEach(function (f) {
          html += '<div class="tree-row"><span class="icon">📄</span><span class="label">' + esc(f) + '</span></div>';
        });
      }
      // 设定目录置顶，其余按卷号排序
      tree.dirs.sort(function (a, b) {
        if (a.name === "设定") return -1;
        if (b.name === "设定") return 1;
        // 从目录名提取卷号：第X卷-[卷名](N-M章)
        var va = a.name.match(/第([0-9一二三四五六七八九十百零]+)卷/);
        var vb = b.name.match(/第([0-9一二三四五六七八九十百零]+)卷/);
        var na = va ? NS.store.cnToArab(va[1]) : 0;
        var nb = vb ? NS.store.cnToArab(vb[1]) : 0;
        return na - nb;
      });
      tree.dirs.forEach(function (d) {
        var isSetting = d.name === "设定";
        // 章节文件按章号从小到大排序
        d.files.sort(function (a, b) {
          var ma = a.match(/第([0-9一二三四五六七八九十百零]+)章/);
          var mb = b.match(/第([0-9一二三四五六七八九十百零]+)章/);
          var na = ma ? NS.store.cnToArab(ma[1]) : 0;
          var nb = mb ? NS.store.cnToArab(mb[1]) : 0;
          return na - nb;
        });
        html += '<div class="tree-node">';
        html += '<div class="tree-row" data-dir="' + esc(d.name) + '"><span class="twisty">▾</span><span class="icon">' + (isSetting ? "⚙️" : "📚") + '</span><span class="label">' + esc(d.name) + '</span></div>';
        html += '<div class="tree-children">';
        d.files.forEach(function (f) {
          html += '<div class="tree-row" data-file="' + esc(d.name + "/" + f) + '"><span class="twisty"></span><span class="icon">📄</span><span class="label">' + esc(f.replace(/\.md$/, "")) + '</span></div>';
        });
        html += '</div></div>';
      });
      treeEl.innerHTML = html || '<div class="tree-empty">暂无文件</div>';

      // 绑定点击
      $$("#tree .tree-row[data-file]").forEach(function (row) {
        row.addEventListener("click", function () {
          $$("#tree .tree-row").forEach(function (r) { r.classList.remove("active"); });
          row.classList.add("active");
          var parts = row.dataset.file.split("/");
          var volDir = parts[0];
          var fileName = parts.slice(1).join("/");
          if (volDir === "设定") {
            openSettingFile(fileName);
          } else {
            loadChapterToEditor(volDir, fileName);
          }
        });
      });

      // 绑定目录折叠/展开
      $$("#tree .tree-row[data-dir]").forEach(function (row) {
        row.addEventListener("click", function (e) {
          var node = row.closest(".tree-node");
          if (node) node.classList.toggle("collapsed");
        });
      });

      // 统计章节数并更新侧边栏
      var chCount = 0;
      tree.dirs.forEach(function (d) {
        if (d.name === "设定") return;
        d.files.forEach(function (f) {
          if (/\.md$/i.test(f)) chCount++;
        });
      });
      var statsEl = $("#treeStats");
      if (statsEl && chCount > 0) {
        // 用 recomputeProgress 获取准确的总字数
        NS.store.recomputeProgress().then(function () {
          var st = NS.store.get();
          var totalW = st.progress.totalWords || 0;
          var wStr = totalW >= 10000 ? (totalW / 10000).toFixed(1) + "万" : String(totalW);
          var html = "共 <b>" + chCount + "</b> 章 · 约 <b>" + wStr + "</b> 字";

          // 如果设置了目标字数，显示进度信息
          if (st.targetWords > 0) {
            var pct = Math.min(100, Math.round((totalW / st.targetWords) * 100));
            var remainW = Math.max(0, st.targetWords - totalW);
            var remainStr = remainW >= 10000 ? (remainW / 10000).toFixed(1) + "万" : remainW.toLocaleString();
            // 按平均每章字数估算剩余章节数
            var avgW = chCount > 0 ? Math.round(totalW / chCount) : 2500;
            var remainCh = Math.ceil(remainW / avgW);
            html += '<br>目标 <b>' + (st.targetWords >= 10000 ? (st.targetWords / 10000).toFixed(0) + "万" : st.targetWords.toLocaleString()) + '</b> 字';
            html += ' · 进度 <b>' + pct + '%</b>';
            if (remainW > 0) {
              html += '<br>还差 <b>' + remainStr + '</b> 字 ≈ <b>' + remainCh + '</b> 章';
            } else {
              html += '<br><span style="color:var(--ok)">🎉 已达标！</span>';
            }
          }
          statsEl.innerHTML = html;
        }).catch(function () {
          statsEl.innerHTML = "共 <b>" + chCount + "</b> 章";
        });
      } else if (statsEl) {
        statsEl.innerHTML = "";
      }
    });
  }

  // ==================== 设定中心 ====================
  var currentSettingFile = "需求确认.md";
  function bindSettingsCenter() {
    $$(".setting-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        $$(".setting-tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        currentSettingFile = tab.dataset.file;
        openSettingFile(currentSettingFile);
      });
    });
    $("#settingSave").addEventListener("click", function () {
      var content = $("#settingEditor").value;
      NS.fs.writeFile(NS.store.SETTING_DIR, currentSettingFile, content).then(function () {
        // 同步到内存
        if (currentSettingFile === "需求确认.md") NS.store.get().requirement = content;
        if (currentSettingFile === "金手指.md") NS.store.get().goldenFinger = content;
        if (currentSettingFile === "世界观.md") NS.store.get().worldview = content;
        if (currentSettingFile === "大纲.md") NS.store.get().outline = content;
        toast("已保存", "ok");
      });
    });

    // 目标字数保存
    var twBtn = $("#targetWordsSave");
    var twInput = $("#targetWordsInput");
    if (twBtn && twInput) {
      twBtn.addEventListener("click", function () {
        var val = parseInt(twInput.value, 10);
        if (!val || val <= 0) {
          toast("请输入有效的目标字数", "err");
          return;
        }
        NS.store.saveTargetWords(val).then(function () {
          toast("目标字数已保存：" + val.toLocaleString() + " 字", "ok");
          refreshTree();
        }).catch(function (e) {
          toast("保存失败：" + e.message, "err");
        });
      });
    }
  }

  // 加载目标字数到输入框
  function loadTargetWordsInput() {
    var twInput = $("#targetWordsInput");
    if (twInput) {
      var st = NS.store.get();
      twInput.value = st.targetWords || "";
    }
  }

  function openSettingFile(fileName) {
    NS.fs.readFile(NS.store.SETTING_DIR, fileName).then(function (text) {
      $("#settingEditor").value = text || "";
      $$(".setting-tab").forEach(function (t) {
        t.classList.toggle("active", t.dataset.file === fileName);
      });
      currentSettingFile = fileName;
      showView("settings-center");
    });
  }

  // ==================== 质量检查 ====================
  function bindCheck() {
    var btn = $("#btnRunCheck");
    log("bindCheck: btnRunCheck =", btn ? "found" : "NOT FOUND");
    if (!btn) { console.error("[NW] #btnRunCheck 元素未找到，无法绑定"); return; }
    btn.addEventListener("click", function () {
      log("btnRunCheck clicked, getRoot =", NS.fs.getRoot() ? NS.fs.getRoot().name : "null");
      renderCheckTable();
    });
  }

  function renderCheckTable() {
    var box = $("#checkTableWrap");
    var btn = $("#btnRunCheck");
    log("renderCheckTable: start, box =", box ? "found" : "NOT FOUND", "getRoot =", NS.fs.getRoot() ? NS.fs.getRoot().name : "null");
    if (!box) { console.error("[NW] #checkTableWrap 不存在"); return; }
    if (!NS.fs.getRoot()) { box.innerHTML = '<p class="hint">未选择作品</p>'; return; }
    // loading 态
    box.innerHTML = '<p class="hint"><span class="spinner"></span> 正在扫描章节…</p>';
    log("renderCheckTable: loading 已设置，开始 buildTree");
    if (btn) { btn.disabled = true; }

    NS.store.buildTree().then(function (tree) {
      log("renderCheckTable: buildTree 返回，dirs =", tree.dirs.length, JSON.stringify(tree.dirs.map(function(d){return {name:d.name, files:d.files};})));
      var rows = [];
      var reads = [];

      tree.dirs.forEach(function (d) {
        if (d.name === "设定") return;
        log("renderCheckTable: 扫描卷目录", d.name, "文件:", JSON.stringify(d.files), "type:", typeof d.files, "isArray:", Array.isArray(d.files), "length:", d.files.length);
        d.files.forEach(function (f) {
          log("renderCheckTable: 内层循环进入，文件:", f, "md测试:", /\.md$/i.test(f));
          if (!/\.md$/i.test(f)) return;
          // 用 Promise.all 并行读取，不依赖链式闭包
          reads.push(
            NS.store.readChapter(d.name, f).then(function (text) {
              log("renderCheckTable: 读取完成", d.name, "→", f, text ? (text.slice(0, 30) + "...") : "空");
              // 兼容多种文件名提取章号/标题
              var chNo = 0;
              var numMatch = f.match(/第([0-9一二三四五六七八九十百零]+)章/);
              if (numMatch) chNo = NS.store.cnToArab(numMatch[1]);
              var title = f.replace(/\.md$/, "")
                .replace(/第[0-9一二三四五六七八九十百零]+章[-\s]*\[(.*?)\].*/, "$1")
                .replace(/第[0-9一二三四五六七八九十百零]+章[-:\s]*/, "")
                .trim() || f;
              var wc = NS.prompts.countChars(text || "");
              var status = "ok", label = "达标";
              if (wc < 2000) { status = "err"; label = "过少"; }
              else if (wc < 2200) { status = "warn"; label = "偏少"; }
              else if (wc > 3800) { status = "warn"; label = "偏多"; }
              var hasTitle = /^#\s*第/.test(text || "");
              rows.push({ chNo: chNo, title: title, wc: wc, status: status, label: label, hasTitle: hasTitle });
            }).catch(function (e) {
              log("renderCheckTable: 读取失败", d.name, "→", f, e.message || e);
              rows.push({ chNo: 0, title: f + "（读取失败）", wc: 0, status: "err", label: "错误", hasTitle: false });
            })
          );
        });
      });

      log("renderCheckTable: reads.length =", reads.length, "rows =", rows.length);
      return Promise.all(reads).then(function () {
        log("renderCheckTable: 所有章节读取完成，rows =", rows.length);
        rows.sort(function (a, b) { return a.chNo - b.chNo; });
        var totalW = rows.reduce(function (s, r) { return s + r.wc; }, 0);
        var html = '<table class="check-table"><thead><tr><th>章节</th><th>标题</th><th>字数</th><th>字数评估</th><th>标题格式</th></tr></thead><tbody>';
        if (!rows.length) html += '<tr><td colspan="5" style="text-align:center;color:var(--text-mute)">还没有章节</td></tr>';
        rows.forEach(function (r) {
          html += '<tr><td>第' + (r.chNo || "?") + '章</td><td>' + esc(r.title) + '</td><td>' + r.wc + '</td>' +
            '<td><span class="badge badge-' + r.status + '">' + r.label + '</span></td>' +
            '<td>' + (r.hasTitle ? '<span class="badge badge-ok">规范</span>' : '<span class="badge badge-warn">缺标题</span>') + '</td></tr>';
        });
        html += '</tbody></table>';
        html += '<p class="hint" style="margin-top:12px">共 ' + rows.length + ' 章，约 ' + (totalW / 10000).toFixed(1) + ' 万字（' + totalW + ' 字）</p>';
        box.innerHTML = html;
      });
    }).catch(function (e) {
      box.innerHTML = '<p class="hint" style="color:var(--danger)">检查失败：' + esc(e.message || String(e)) + '</p>';
      toast("检查失败：" + (e.message || e), "err");
    }).then(function () {
      if (btn) { btn.disabled = false; }
    });
  }

  // 暴露
  NS.app = {
    init: init,
    showView: showView,
    refreshTree: refreshTree,
    toast: toast
  };

  // 自动启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
