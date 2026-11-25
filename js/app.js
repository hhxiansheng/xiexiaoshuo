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
      log("init: bindNav");
      bindNav();
      log("init: bindImporter");
      bindImporter();
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
      // 初始化类型选择器 UI
      updateGenreUI(NS.store.get().genre || "xuanhuan");
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
        if (st && st.genre) {
          var gs = $("#genreSelect");
          if (gs) gs.value = st.genre;
          updateGenreUI(st.genre);
        }
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

    var goImport = $("#btnGoImport");
    if (goImport) goImport.addEventListener("click", function () {
      showView("importer");
      renderImportView();
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
      if (st.genre) {
        var gs = $("#genreSelect");
        if (gs) gs.value = st.genre;
        updateGenreUI(st.genre);
      }
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
        // 导入页允许在未选文件夹时进入，页面内会提示去首页
        showView(b.dataset.nav);
        if (b.dataset.nav === "editor") refreshTree();
        if (b.dataset.nav === "check") renderCheckTable();
        if (b.dataset.nav === "importer") renderImportView();
      });
    });
  }

  // ==================== 导入设定 ====================
  function bindImporter() {
    var dropZone = $("#impDropZone");
    var fileInput = $("#impFileInput");

    function pickFiles() { if (fileInput) fileInput.click(); }

    if (dropZone) {
      dropZone.addEventListener("click", pickFiles);
      dropZone.addEventListener("dragover", function (e) {
        e.preventDefault();
        dropZone.classList.add("dragging");
      });
      dropZone.addEventListener("dragleave", function () {
        dropZone.classList.remove("dragging");
      });
      dropZone.addEventListener("drop", function (e) {
        e.preventDefault();
        dropZone.classList.remove("dragging");
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files[0]) handleFile(files[0]);
      });
    }
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
        fileInput.value = "";
      });
    }
    if ($("#impPickFile")) $("#impPickFile").addEventListener("click", pickFiles);
    if ($("#impClear")) $("#impClear").addEventListener("click", function () {
      NS.importer.reset();
      renderImportView();
    });
    if ($("#impGoHome")) $("#impGoHome").addEventListener("click", function () {
      showView("home");
    });

    // 选项
    if ($("#impOptFiles")) $("#impOptFiles").addEventListener("change", function (e) {
      NS.importer.getOptions().writeFiles = e.target.checked;
    });
    if ($("#impOptMeta")) $("#impOptMeta").addEventListener("change", function (e) {
      NS.importer.getOptions().applyMeta = e.target.checked;
    });
    if ($("#impOptVolume")) $("#impOptVolume").addEventListener("change", function (e) {
      NS.importer.getOptions().applyVolumeConfig = e.target.checked;
    });
    if ($("#impOptExpand")) $("#impOptExpand").addEventListener("change", function (e) {
      NS.importer.getOptions().expandChapterOutlines = e.target.checked;
      var row = $("#impExpandRow");
      if (row) row.style.display = e.target.checked ? "" : "none";
    });
    if ($("#impExpandVolumes")) $("#impExpandVolumes").addEventListener("change", function (e) {
      NS.importer.getOptions().expandVolumes = parseInt(e.target.value, 10) || 1;
    });

    if ($("#impStart")) $("#impStart").addEventListener("click", doImport);
  }

  function handleFile(file) {
    if (!/\.(md|txt|markdown)$/i.test(file.name)) {
      toast("请选择 .md 或 .txt 文件", "err");
      return;
    }
    NS.importer.readFromFile(file, function () {
      toast("解析成功", "ok");
      renderImportView();
    }, function (e) {
      toast("读取失败：" + (e.message || e), "err");
    });
  }

  function esc2(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderImportView() {
    var st = NS.importer.getState();
    var p = st.parsed;

    // 未选文件夹提示
    var noRoot = $("#impNoRoot");
    if (noRoot) noRoot.style.display = NS.fs.getRoot() ? "none" : "";

    // 上传区标题
    var title = $("#impDropTitle");
    if (title) title.textContent = st.fileName || "点击选择或拖入 .md 文件";

    var clearBtn = $("#impClear");
    if (clearBtn) clearBtn.style.display = p ? "" : "none";

    var resultBox = $("#impResult");
    if (!resultBox) return;
    if (!p) { resultBox.style.display = "none"; return; }
    resultBox.style.display = "";

    // 元信息
    var metaBody = $("#impMetaBody");
    if (metaBody) {
      var m = p.meta;
      var rows = [];
      if (m.bookTitle) rows.push(["书名", esc2(m.bookTitle)]);
      if (m.genreText) {
        var g = NS.settingParser.guessGenre(m.genreText);
        var label = (NS.prompts.GENRE_PROFILES[g] || {}).label || g;
        rows.push(["类型", esc2(m.genreText) + " → " + esc2(label)]);
      }
      var words = NS.settingParser.parseWordCount(m.targetWordsText);
      if (words) rows.push(["目标字数", esc2(m.targetWordsText) + "（" + words.toLocaleString() + " 字）"]);
      var chs = NS.settingParser.cnNumToInt(m.totalChaptersText);
      if (chs) rows.push(["总章节", chs + " 章"]);
      var vols = NS.settingParser.cnNumToInt(m.totalVolumesText);
      if (vols) rows.push(["总卷数", vols + " 卷"]);
      if (m.protagonist) rows.push(["主角", esc2(m.protagonist)]);
      if (m.goldenFingerName) rows.push(["核心设定", esc2(m.goldenFingerName)]);

      var volHtml;
      if (p.volumes.length) {
        volHtml = "识别到 <b>" + p.volumes.length + "</b> 卷，每卷约 <b>" +
          p.chaptersPerVolume + "</b> 章（" + p.volumes[0].start + "-" +
          p.volumes[p.volumes.length - 1].end + " 章）";
      } else {
        volHtml = '<span style="color:var(--warning)">未识别到卷结构</span>';
      }
      rows.push(["卷结构", volHtml]);

      metaBody.innerHTML = rows.map(function (r) {
        return '<tr><td style="width:110px;color:var(--text-soft)">' + r[0] + "</td><td>" + r[1] + "</td></tr>";
      }).join("");
    }

    // 警告
    var warnBox = $("#impWarnings");
    if (warnBox) {
      if (p.warnings.length) {
        warnBox.style.display = "";
        warnBox.style.background = "var(--warning-soft)";
        warnBox.style.borderColor = "var(--warning)";
        warnBox.innerHTML = p.warnings.map(function (w) {
          return '<div class="hint">⚠️ ' + esc2(w) + "</div>";
        }).join("");
      } else {
        warnBox.style.display = "none";
      }
    }

    // 文件列表
    var filesBody = $("#impFilesBody");
    if (filesBody) {
      var names = Object.keys(p.files);
      filesBody.innerHTML = names.map(function (n) {
        var content = p.files[n];
        var preview = content.slice(0, 120).replace(/\n/g, " ");
        return "<tr><td><b>" + esc2(n) + "</b></td><td>" + content.length + " 字符</td>" +
          '<td class="hint" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc2(preview) + "</td></tr>";
      }).join("");
    }

    // 卷结构
    var volCard = $("#impVolumeCard");
    var volBody = $("#impVolumeBody");
    if (volCard && volBody) {
      if (p.volumes.length) {
        volCard.style.display = "";
        volBody.innerHTML = p.volumes.map(function (v) {
          return "<tr><td>第" + v.no + "卷</td><td>" + esc2(v.name) + '</td><td class="hint">' +
            v.start + "-" + v.end + "</td></tr>";
        }).join("");
      } else {
        volCard.style.display = "none";
      }
    }

    // 卷配置提示
    var vh = $("#impVolumeHint");
    if (vh) {
      var cur = NS.store.getChaptersPerVolume();
      if (cur === p.chaptersPerVolume) {
        vh.textContent = "当前作品设置：每卷 " + cur + " 章";
      } else {
        vh.innerHTML = "当前作品设置：每卷 " + cur + " 章 → " +
          '<span style="color:var(--warning)">将被修改为 ' + p.chaptersPerVolume + " 章</span>";
      }
    }

    var eh = $("#impExpandHint");
    if (eh) eh.textContent = "共 " + p.volumes.length + " 卷。一次展开太多会很慢且耗 token，建议先展开 1-2 卷开始写。";

    var ev = $("#impExpandVolumes");
    if (ev) ev.max = p.volumes.length || 1;
  }

  function doImport() {
    var btn = $("#impStart");
    var statusEl = $("#impStatus");
    var logBox = $("#impLog");
    var logBody = $("#impLogBody");

    if (!NS.fs.getRoot()) {
      toast("请先到首页选择作品文件夹", "err");
      return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 导入中…'; }
    if (statusEl) statusEl.textContent = "";
    if (logBox) logBox.style.display = "none";

    // 进度轮询（AI 展开时更新日志）
    var pollId = setInterval(function () {
      var st = NS.importer.getState();
      if (st.expanding || st.expandLog.length) {
        if (logBox) logBox.style.display = "";
        if (logBody) logBody.innerHTML = st.expandLog.map(function (l) { return esc2(l); }).join("<br>");
        if (statusEl) {
          if (st.expanding) {
            statusEl.innerHTML = '<span class="spinner"></span> 正在展开 ' +
              esc2(st.expandProgress.current || "…") +
              "（" + st.expandProgress.done + "/" + st.expandProgress.total + "）";
          }
        }
      }
    }, 300);

    NS.importer.runImport(function () {
      clearInterval(pollId);
      if (btn) { btn.disabled = false; btn.textContent = "📥 开始导入"; }
      if (statusEl) statusEl.textContent = "";
      toast("设定导入完成", "ok");
      refreshTree();
      refreshTopbar();
      showView("settings-center");
    }, function (e) {
      clearInterval(pollId);
      if (btn) { btn.disabled = false; btn.textContent = "📥 开始导入"; }
      if (statusEl) statusEl.textContent = "";
      toast("导入失败：" + (e.message || e), "err");
    });
  }

  // ==================== 设置 ====================
  var cfgFetchedModels = [];

  function renderProviderSelect(selectedId) {
    var sel = $("#cfgProvider");
    if (!sel) return;
    var groups = NS.providers.getProvidersByGroup();
    var html = "";
    groups.forEach(function (g) {
      html += '<optgroup label="' + esc2(g.label) + '">';
      g.providers.forEach(function (p) {
        html += '<option value="' + esc2(p.id) + '">' + esc2(p.name) + "</option>";
      });
      html += "</optgroup>";
    });
    sel.innerHTML = html;
    sel.value = selectedId || NS.providers.DEFAULT_PROVIDER_ID;
  }

  function currentProviderForForm() {
    var pid = $("#cfgProvider") ? $("#cfgProvider").value : NS.providers.DEFAULT_PROVIDER_ID;
    return NS.providers.getProvider(pid);
  }

  function renderProviderHint() {
    var p = currentProviderForForm();
    var hint = $("#cfgProviderHint");
    if (!hint) return;

    var protoLabel = "OpenAI 兼容";
    if (p.protocol === NS.providers.PROTOCOLS.ANTHROPIC) protoLabel = "Anthropic Messages API";
    else if (p.protocol === NS.providers.PROTOCOLS.GOOGLE) protoLabel = "Google Gemini API";

    var authLabel = "Authorization: Bearer";
    if (p.authType === NS.providers.AUTH_TYPES.X_API_KEY) authLabel = "x-api-key 头";
    else if (p.authType === NS.providers.AUTH_TYPES.API_KEY) authLabel = "api-key 头";
    else if (p.authType === NS.providers.AUTH_TYPES.GOOGLE_KEY) authLabel = "x-goog-api-key 头";
    else if (p.authType === NS.providers.AUTH_TYPES.NONE) authLabel = "无需鉴权";

    var html = "协议：<b>" + esc2(protoLabel) + "</b> ｜ 鉴权：<b>" + esc2(authLabel) + "</b>";
    if (p.requiresSession) {
      html += "<br>会话头：<b>x-opencode-session</b>（已自动注入）";
    }
    if (p.corsBlocked) {
      html += '<br><span style="color:var(--warning)">⚠️ 该服务不开放浏览器跨域，会自动通过本地代理转发</span>';
    }
    if (p.note) html += "<br>" + esc2(p.note);
    hint.innerHTML = html;

    // Key 提示
    var keyHint = $("#cfgKeyHint");
    if (keyHint) keyHint.style.display = p.authType === NS.providers.AUTH_TYPES.NONE ? "" : "none";

    // 温度上限
    var tempInput = $("#cfgTemp");
    if (tempInput) tempInput.max = p.tempMax || 2;

    // 输出上限提示
    var mtHint = $("#cfgMaxTokensHint");
    if (mtHint) mtHint.textContent = "上限 " + p.maxOutput + "，超出会自动裁剪";

    // Base URL 提示
    var buHint = $("#cfgBaseUrlHint");
    if (buHint) {
      buHint.textContent = p.id === "custom"
        ? "填到版本号即可，如 https://api.example.com/v1；也可直接填完整的 /chat/completions 地址"
        : "使用预设端点，一般无需修改";
    }

    renderModelChips();
  }

  function renderModelChips() {
    var box = $("#cfgModelChips");
    if (!box) return;
    var p = currentProviderForForm();
    var list = (p.models || []).concat(cfgFetchedModels);
    // 去重
    var seen = {}, uniq = [];
    list.forEach(function (m) { if (m && !seen[m]) { seen[m] = 1; uniq.push(m); } });

    var current = $("#cfgModel") ? $("#cfgModel").value : "";
    box.innerHTML = uniq.map(function (m) {
      return '<span class="model-chip' + (m === current ? " active" : "") +
        '" data-model="' + esc2(m) + '">' + esc2(m) + "</span>";
    }).join("");

    $$("#cfgModelChips .model-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        $("#cfgModel").value = chip.dataset.model;
        renderModelChips();
      });
    });
  }

  function collectCfgPatch() {
    var maxT = parseInt($("#cfgMaxTokens").value, 10);
    return {
      providerId: $("#cfgProvider").value,
      baseUrl: $("#cfgBaseUrl").value.trim(),
      apiKey: $("#cfgApiKey").value.trim(),
      model: $("#cfgModel").value.trim(),
      temperature: parseFloat($("#cfgTemp").value) || 0.85,
      maxTokens: maxT > 0 ? maxT : 4096,
      omitTemperature: $("#cfgOmitTemp").checked,
      extraHeaders: $("#cfgExtraHeaders").value.trim(),
      platform: $("#cfgPlatform").value
    };
  }

  function bindSettings() {
    var c = NS.config.load();

    // 老配置没有 providerId 时，按 baseUrl 猜一个
    var pid = c.providerId;
    if (!pid) {
      var list = NS.providers.PROVIDERS;
      for (var i = 0; i < list.length; i++) {
        if (list[i].baseUrl && c.baseUrl && c.baseUrl.indexOf(list[i].baseUrl) === 0) {
          pid = list[i].id;
          break;
        }
      }
      pid = pid || NS.providers.DEFAULT_PROVIDER_ID;
    }

    renderProviderSelect(pid);
    $("#cfgBaseUrl").value = c.baseUrl || "";
    $("#cfgApiKey").value = c.apiKey || "";
    $("#cfgModel").value = c.model || "";
    $("#cfgTemp").value = c.temperature;
    $("#cfgMaxTokens").value = c.maxTokens || 4096;
    $("#cfgOmitTemp").checked = !!c.omitTemperature;
    $("#cfgExtraHeaders").value = c.extraHeaders || "";
    $("#cfgPlatform").value = c.platform;
    renderProviderHint();

    // 切换厂商
    $("#cfgProvider").addEventListener("change", function () {
      var p = currentProviderForForm();
      $("#cfgBaseUrl").value = p.baseUrl || "";
      $("#cfgModel").value = (p.models && p.models[0]) || "";
      $("#cfgTemp").value = Math.min(0.85, p.tempMax || 2);
      $("#cfgTemp").max = p.tempMax || 2;
      cfgFetchedModels = [];
      renderProviderHint();
    });

    // 模型名手动改动时刷新 chip 高亮
    $("#cfgModel").addEventListener("input", renderModelChips);

    // 显示/隐藏 Key
    var keyVisible = false;
    $("#btnToggleKey").addEventListener("click", function () {
      keyVisible = !keyVisible;
      $("#cfgApiKey").type = keyVisible ? "text" : "password";
      $("#btnToggleKey").textContent = keyVisible ? "🙈 隐藏" : "👁️ 显示";
    });

    // 拉取模型列表
    $("#btnFetchModels").addEventListener("click", function () {
      var btn = $("#btnFetchModels");
      NS.config.save(collectCfgPatch());
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 拉取中…';

      NS.ai.listModels().then(function (list) {
        cfgFetchedModels = list;
        renderModelChips();
        toast("已拉取 " + list.length + " 个模型", "ok");
      }).catch(function (e) {
        toast("拉取失败：" + e.message, "err");
      }).then(function () {
        btn.disabled = false;
        btn.textContent = "🔄 从服务端拉取模型列表";
      });
    });

    $("#btnSaveConfig").addEventListener("click", function () {
      NS.config.save(collectCfgPatch());
      toast("设置已保存", "ok");
    });

    $("#btnTestConn").addEventListener("click", function () {
      NS.config.save(collectCfgPatch());
      var btn = $("#btnTestConn");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 测试中…';
      NS.ai.testConnection().then(function (r) {
        toast("连接成功：" + (r.reply || "OK"), "ok");
      }).catch(function (e) {
        toast("连接失败：" + e.message, "err");
      }).then(function () {
        btn.disabled = false;
        btn.textContent = "🔌 测试连接";
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

    // 类型选择器
    var genreSelect = $("#genreSelect");
    if (genreSelect) {
      genreSelect.addEventListener("change", function () {
        updateGenreUI(genreSelect.value);
        if (NS.fs.getRoot()) {
          NS.store.saveGenre(genreSelect.value);
        }
      });
    }

    // Step1 需求确认
    $("#btnGenReq").addEventListener("click", genRequirement);

    // Step2 模板选择（金手指）
    $$("#wizStep2GF .tpl-card").forEach(function (card) {
      card.addEventListener("click", function () {
        $$("#wizStep2GF .tpl-card").forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        wizardTpl = card.dataset.tpl;
      });
    });
    // Step2 模板选择（核心设定）
    $$("#wizStep2Core .tpl-card").forEach(function (card) {
      card.addEventListener("click", function () {
        $$("#wizStep2Core .tpl-card").forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        wizardTpl = card.dataset.tpl;
      });
    });
    $("#btnGenGF").addEventListener("click", genGoldenFinger);
    $("#btnGenCore").addEventListener("click", genCoreSetting);

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
    var req = $("#reqResult"), gf = $("#gfResult"), core = $("#coreResult"), ol = $("#outlineResult");
    if (req && req.textContent.trim()) NS.store.get().requirement = req.textContent;
    if (gf && gf.textContent.trim()) NS.store.get().goldenFinger = gf.textContent;
    if (core && core.textContent.trim()) NS.store.get().goldenFinger = core.textContent;
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
      genre: NS.store.get().genre || "xuanhuan",
      type: $("#fType").value.trim(),
      protagonist: $("#fProtagonist").value.trim(),
      theme: $("#fTheme").value.trim(),
      worldview: $("#fWorldview").value.trim(),
      targetWords: $("#fTargetWords").value.trim(),
      special: $("#fSpecial").value.trim()
    };
  }

  // 根据类型更新向导 UI（步骤2面板、标签等）
  function updateGenreUI(genre) {
    var profile = NS.prompts.GENRE_PROFILES[genre] || NS.prompts.GENRE_PROFILES.xuanhuan;
    var st = NS.store.get();
    st.genre = genre;

    // 更新步骤2标签文字
    var step2Label = $("#step2Label");
    if (step2Label) step2Label.textContent = profile.step2Title;

    // 切换步骤2面板
    var gfPanel = $("#wizStep2GF");
    var corePanel = $("#wizStep2Core");
    if (gfPanel && corePanel) {
      if (profile.hasGoldenFinger) {
        gfPanel.style.display = "";
        corePanel.style.display = "none";
      } else {
        gfPanel.style.display = "none";
        corePanel.style.display = "";
      }
    }

    // 更新核心设定面板标题
    var coreTitle = $("#coreSettingTitle");
    if (coreTitle) coreTitle.textContent = "选择" + profile.step2Title + "模板";

    // 刷新章节类型选择器
    populateChapterTypeSelect($("#wizChType"));
    populateChapterTypeSelect($("#editorChType"));
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

  function genCoreSetting() {
    var req = collectReqForm();
    var reqText = NS.store.get().requirement || $("#reqResult").textContent;
    if (!reqText) { toast("请先在步骤1生成需求确认", "err"); return; }
    var btn = $("#btnGenCore"); setBusy(btn, true);
    var box = $("#coreResult");
    streamGenerate(function () {
      return NS.prompts.buildCoreSetting(req, wizardTpl, reqText);
    }, box)
      .then(function (text) {
        NS.store.get().goldenFinger = text;
        return NS.fs.getRoot() ? NS.store.saveGoldenFinger(text) : null;
      })
      .then(function () { toast("核心设定已生成并保存", "ok"); })
      .catch(function () {})
      .then(function () { setBusy(btn, false); });
  }

  function genOutline() {
    var reqText = NS.store.get().requirement || $("#reqResult").textContent;
    var gfText = NS.store.get().goldenFinger || $("#gfResult").textContent || ($("#coreResult") ? $("#coreResult").textContent : "");
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
    var genre = NS.store.get().genre || "xuanhuan";
    var profile = NS.prompts.GENRE_PROFILES[genre] || NS.prompts.GENRE_PROFILES.xuanhuan;
    var types = profile.chapterTypes;
    Object.keys(types).forEach(function (k) {
      var t = types[k];
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
      genre: st.genre,
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
              genre: st.genre,
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
      '<div class="review-content" id="extendResult" style="min-height:200px">正在读取最近章节…</div>' +
      '<div class="review-footer"><button id="extendClose" class="btn" disabled>关闭</button></div>';
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
          genre: st.genre,
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

        var prompt = NS.prompts.buildVolumeReview(volDirName, chapterTexts, NS.store.get().genre);

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
    var btnHTML = '<div class="review-footer">' +
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
    var diffs = [];  // 收集修正前后对比

    chapterTexts.reduce(function (chain, ch) {
      return chain.then(function () {
        progressText.textContent = "修正第" + ch.chNo + "章…（" + done + "/" + total + "）";
        progressBar.style.width = Math.round((done / total) * 100) + "%";

        var prompt = NS.prompts.buildChapterFix(reviewResult, ch, NS.store.get().genre);
        return NS.ai.chat(prompt).then(function (fixedText) {
          if (!fixedText || fixedText.length < 200) {
            // AI 返回太短，跳过
            done++;
            return;
          }
          // 记录修正前后对比
          diffs.push({
            chNo: ch.chNo,
            title: ch.title,
            before: ch.text,
            after: fixedText
          });
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
      // 添加查看修正对比按钮
      if (diffs.length > 0) {
        var footer = dialog.querySelector(".review-footer");
        if (footer) {
          var diffBtn = document.createElement("button");
          diffBtn.className = "btn btn-primary";
          diffBtn.textContent = "📝 查看修正对比（" + diffs.length + " 章）";
          diffBtn.addEventListener("click", function () {
            showFixDiff(diffs);
          });
          footer.insertBefore(diffBtn, footer.firstChild);
        }
      }
      toast("卷内修正完成，修正了 " + fixed + " 章", "");
      // 刷新侧边栏和编辑器
      refreshTree();
    }).catch(function (e) {
      progressText.textContent = "修正中断：" + e.message;
      fixBtn.disabled = false;
      fixBtn.textContent = "🔧 重试修正";
    });
  }

  // 显示修正前后对比
  function showFixDiff(diffs) {
    var overlay = document.createElement("div");
    overlay.className = "review-overlay";
    var dialog = document.createElement("div");
    dialog.className = "review-dialog diff-dialog";

    var headerHTML = '<h3 style="margin:0 0 12px">📝 修正对比（共 ' + diffs.length + ' 章）</h3>';

    // 章节标签页
    var tabsHTML = '<div class="diff-tabs">';
    diffs.forEach(function (d, i) {
      tabsHTML += '<div class="diff-tab' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">第' + d.chNo + '章</div>';
    });
    tabsHTML += '</div>';

    // 对比内容区
    var contentHTML = '<div class="diff-body" id="diffBody"></div>';

    var btnHTML = '<div class="review-footer">' +
      '<button id="diffCloseBtn" class="btn">关闭</button></div>';

    dialog.innerHTML = headerHTML + tabsHTML + contentHTML + btnHTML;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var body = dialog.querySelector("#diffBody");

    function renderDiff(idx) {
      var d = diffs[idx];
      var beforeLines = (d.before || "").split("\n");
      var afterLines = (d.after || "").split("\n");
      // 简单逐行对比
      var maxLines = Math.max(beforeLines.length, afterLines.length);
      var html = '<div class="diff-cols">' +
        '<div class="diff-col diff-col-before"><div class="diff-col-title">修正前</div>' +
        '<div class="diff-col-body">';
      for (var i = 0; i < beforeLines.length; i++) {
        var changed = i < afterLines.length && beforeLines[i] !== afterLines[i];
        html += '<div class="diff-line' + (changed ? ' diff-changed' : '') + '">' + esc(beforeLines[i]) + '</div>';
      }
      html += '</div></div>' +
        '<div class="diff-col diff-col-after"><div class="diff-col-title">修正后</div>' +
        '<div class="diff-col-body">';
      for (var i = 0; i < afterLines.length; i++) {
        var changed = i < beforeLines.length && beforeLines[i] !== afterLines[i];
        html += '<div class="diff-line' + (changed ? ' diff-changed' : '') + '">' + esc(afterLines[i]) + '</div>';
      }
      html += '</div></div></div>';
      body.innerHTML = html;
      // 同步滚动
      var cols = body.querySelectorAll(".diff-col-body");
      if (cols.length === 2) {
        var syncing = false;
        cols.forEach(function (col) {
          col.addEventListener("scroll", function () {
            if (syncing) return;
            syncing = true;
            cols.forEach(function (other) {
              if (other !== col) other.scrollTop = col.scrollTop;
            });
            syncing = false;
          });
        });
      }
    }

    renderDiff(0);

    // 标签切换
    dialog.querySelectorAll(".diff-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        dialog.querySelectorAll(".diff-tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        renderDiff(parseInt(tab.dataset.idx, 10));
      });
    });

    var closeBtn = dialog.querySelector("#diffCloseBtn");
    closeBtn.addEventListener("click", function () {
      document.body.removeChild(overlay);
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) document.body.removeChild(overlay);
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
    var genre = NS.store.get().genre || "xuanhuan";
    var profile = NS.prompts.GENRE_PROFILES[genre] || NS.prompts.GENRE_PROFILES.xuanhuan;
    var ct = profile.chapterTypes[$("#editorChType").value];
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

  // 根据大纲关键词 + 章节在卷内的位置，自动选择章节类型（按类型适配）
  function autoSelectChapterType(chNo) {
    var sel = $("#editorChType");
    if (!sel) return;
    var st = NS.store.get();
    var genre = st.genre || "xuanhuan";
    var chs = NS.store.parseOutlineChapters(st.outline || "");
    var ch = chs.filter(function (c) { return c.num === chNo; })[0];
    // 标题+详情拼一起匹配，覆盖面更大
    var info = ch ? ((ch.title || "") + " " + (ch.detail || "")) : "";

    // 卷内位置（1-10）
    var posInVol = ((chNo - 1) % 10) + 1;

    if (genre === "romance") {
      // 言情类关键词匹配
      if (/告白|表白|确认关系|在一起|接受|求婚|答应/.test(info)) { sel.value = "confess"; return; }
      if (/误会|误解|嫉妒|吃醋|冷战|猜疑|怀疑|争吵|吵架|争执|闹翻/.test(info)) { sel.value = "misunder"; return; }
      if (/冲突|决裂|分手|离开|离别|撕裂|对峙|对抗/.test(info)) { sel.value = "conflict"; return; }
      if (/和好|和解|道歉|原谅|理解|释怀|敞开心扉/.test(info)) { sel.value = "reconcile"; return; }
      if (/甜蜜|约会|牵手|拥抱|亲吻|心动|暧昧|亲昵|温情|浪漫|礼物|惊喜/.test(info)) { sel.value = "sweet"; return; }
      if (/悸动|暗生情愫|在意|注意|留意|好感|暗恋|心动|小鹿乱撞|脸红|害羞/.test(info)) { sel.value = "heartbeat"; return; }
      if (/重逢|再见|偶遇|邂逅|初遇|相遇|撞见|结识|相识/.test(info)) { sel.value = "encounter"; return; }
      if (/高潮|转折|真相大白|重大决定|选择|牺牲|守护|危机/.test(info)) { sel.value = "climax"; return; }
      if (/日常|上课|放学|工作|逛街|吃饭|回家|休息|周末|假期/.test(info)) { sel.value = "daily"; return; }
      // 兜底按位置
      if (posInVol === 10) { sel.value = "wrap"; }
      else if (posInVol === 9) { sel.value = "climax"; }
      else if (posInVol <= 2) { sel.value = "encounter"; }
      else if (posInVol <= 5) { sel.value = "heartbeat"; }
      else { sel.value = "sweet"; }
    } else if (genre === "urban") {
      if (/冲突|对抗|对峙|竞争|博弈|交锋|角力/.test(info)) { sel.value = "conflict"; return; }
      if (/情感|内心|挣扎|感悟|领悟|释怀|感动|温暖/.test(info)) { sel.value = "emotion"; return; }
      if (/高潮|转折|逆袭|翻盘|真相|揭秘|爆发/.test(info)) { sel.value = "climax"; return; }
      if (/收束|尾声|新篇章|新征程/.test(info)) { sel.value = "wrap"; return; }
      if (/调查|发现|线索|计划|布局|分析|研究|学习/.test(info)) { sel.value = "develop"; return; }
      // 兜底
      if (posInVol === 10) { sel.value = "wrap"; }
      else if (posInVol === 9) { sel.value = "climax"; }
      else if (posInVol <= 2) { sel.value = "setup"; }
      else if (posInVol <= 5) { sel.value = "develop"; }
      else { sel.value = "conflict"; }
    } else if (genre === "mystery") {
      if (/真相|揭露|揭秘|答案|谜底|真相大白|水落石出/.test(info)) { sel.value = "reveal"; return; }
      if (/反转|逆转|颠覆|意外|震惊|震惊|难以置信/.test(info)) { sel.value = "twist"; return; }
      if (/线索|证据|发现|关键|蛛丝马迹|端倪/.test(info)) { sel.value = "clue"; return; }
      if (/危险|追杀|威胁|陷阱|危机|命悬一线|千钧一发/.test(info)) { sel.value = "tension"; return; }
      if (/调查|走访|询问|排查|追踪|监视|蹲守/.test(info)) { sel.value = "investigate"; return; }
      if (/伏笔|暗示|预兆|铺垫/.test(info)) { sel.value = "foreshadow"; return; }
      // 兜底
      if (posInVol === 10) { sel.value = "wrap"; }
      else if (posInVol === 9) { sel.value = "climax"; }
      else if (posInVol <= 2) { sel.value = "foreshadow"; }
      else if (posInVol <= 5) { sel.value = "investigate"; }
      else { sel.value = "tension"; }
    } else if (genre === "scifi") {
      if (/决战|高潮|大决战|最终对决|终极|最终战/.test(info)) { sel.value = "climax"; return; }
      if (/战斗|交战|突围|反击|进攻|防守|突袭|伏击|激战/.test(info)) { sel.value = "battle"; return; }
      if (/发现|突破|解密|真相|遗迹|信号|异变/.test(info)) { sel.value = "discover"; return; }
      if (/危机|灾难|袭击|入侵|警报|紧急/.test(info)) { sel.value = "crisis"; return; }
      if (/收束|尾声|新篇章/.test(info)) { sel.value = "wrap"; return; }
      // 兜底
      if (posInVol === 10) { sel.value = "wrap"; }
      else if (posInVol === 9) { sel.value = "climax"; }
      else if (posInVol <= 2) { sel.value = "buildup"; }
      else if (posInVol <= 5) { sel.value = "buildup"; }
      else { sel.value = "battle"; }
    } else {
      // 玄幻/修仙（默认）
      if (/决战|高潮|大决战|最终对决|终极|最终战|决战前夕/.test(info)) { sel.value = "climax"; return; }
      if (/战斗|突破|交手|对决|反杀|搏杀|激战|围攻|追杀|伏击|混战|恶战|血战|厮杀|爆炸|袭击|入侵|突围|对抗|格斗|狙击|进攻|防守|反击|覆灭|毁灭/.test(info)) { sel.value = "battle"; return; }
      if (/重逢|真相|揭露|内心|挣扎|告别|牺牲|感动|回忆|誓言|告白|离别|思念|悲伤|痛苦|眼泪|心痛|守护|约定|承诺|牵挂|担忧|恐惧|绝望|希望|温暖|深情|黑暗|黎明|孤独|觉醒|顿悟|震撼|震惊|愤怒|决心/.test(info)) { sel.value = "emotion"; return; }
      if (/卷末|收束|尾声|新篇章|新征程|新旅程|下一卷/.test(info)) { sel.value = "wrap"; return; }
      if (/情报|计划|布局|谋划|打探|分析|准备|试探|调查|追踪|推理|研究|学习|修炼|训练|实验|策划|密谋|发现|探索|线索|蛛丝马迹/.test(info)) { sel.value = "buildup"; return; }
      if (/离开|抵达|日常|赶路|休整|返回|搬家|旅行|安顿|休息|采购|逛街|上课|回家/.test(info)) { sel.value = "transition"; return; }
      if (/危机|冲突/.test(info)) { sel.value = "battle"; return; }
      // 兜底
      if (posInVol === 10) { sel.value = "wrap"; }
      else if (posInVol === 9) { sel.value = "climax"; }
      else if (posInVol <= 2) { sel.value = "buildup"; }
      else if (posInVol <= 5) { sel.value = "buildup"; }
      else { sel.value = "battle"; }
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
