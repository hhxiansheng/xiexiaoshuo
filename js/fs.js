/* ============================================================
   fs.js - File System Access API 封装
   挂在全局命名空间 NW.fs
   职责：
   - 选择/授权作品文件夹
   - 读写真实 Markdown 文件（严格遵循 SKILL.md 第九章目录规范）
   - 用 IndexedDB 持久化目录句柄，下次打开一键恢复
   ============================================================ */
(function (global) {
  "use strict";

  var NS = global.NW = global.NW || {};

  // ---------- 能力检测 ----------
  function supported() {
    return "showDirectoryPicker" in global;
  }

  // ---------- IndexedDB 持久化句柄 ----------
  var DB_NAME = "nw_fs";
  var STORE = "handles";
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function idbSet(key, val) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var r = tx.objectStore(STORE).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function idbDel(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // ---------- 目录句柄管理 ----------
  // root: 作品根目录句柄（一本书 = 一个文件夹）
  var rootHandle = null;

  function getRoot() { return rootHandle; }

  // 用户手动选择文件夹
  function pickDirectory() {
    return global.showDirectoryPicker({ mode: "readwrite" }).then(function (h) {
      rootHandle = h;
      return idbSet("root", h).then(function () { return h; });
    });
  }

  // 启动时尝试恢复上次授权的目录（仍需用户点确认 verifyPermission）
  function restoreDirectory() {
    return idbGet("root").then(function (h) {
      if (!h) return null;
      rootHandle = h;
      return h;
    });
  }

  // 请求读写权限（授权过的目录重新打开时也要请求）
  // 请求读写权限。
  // 句柄从 IndexedDB 恢复后权限不会自动带过来，需调用 requestPermission 重新弹框授权。
  // queryPermission 仅查询不弹框；requestPermission 会弹框。
  function verifyPermission(handle) {
    if (!handle) return Promise.resolve(false);
    var opts = { mode: "readwrite" };
    // 先查（不弹框）
    return Promise.resolve(handle.queryPermission ? handle.queryPermission(opts) : "prompt")
      .then(function (state) {
        if (state === "granted") return true;
        // 没权限就请求（弹框）
        return Promise.resolve(handle.requestPermission ? handle.requestPermission(opts) : "prompt")
          .then(function (state2) { return state2 === "granted"; });
      });
  }

  function clearRoot() {
    rootHandle = null;
    return idbDel("root");
  }

  // ---------- 目录/文件 操作 ----------
  // 递归获取子目录句柄，缺失则创建
  function getDirHandle(pathSegments, create) {
    if (!rootHandle) return Promise.reject(new Error("尚未选择作品文件夹"));
    create = create !== false;
    var p = Promise.resolve(rootHandle);
    pathSegments.forEach(function (seg) {
      p = p.then(function (dir) {
        return dir.getDirectoryHandle(seg, { create: !!create });
      });
    });
    return p;
  }

  // 读取文件内容，不存在返回 null
  function readFile(pathSegments, fileName) {
    return getDirHandle(pathSegments, false).then(function (dir) {
      return dir.getFileHandle(fileName).then(function (fh) {
        return fh.getFile();
      }).then(function (f) {
        return f.text();
      });
    }).catch(function (err) {
      if (err && err.name === "NotFoundError") return null;
      throw err;
    });
  }

  // 写入文件（覆盖）
  function writeFile(pathSegments, fileName, content) {
    return getDirHandle(pathSegments, true).then(function (dir) {
      return dir.getFileHandle(fileName, { create: true });
    }).then(function (fh) {
      return fh.createWritable();
    }).then(function (w) {
      return w.write(content).then(function () { return w.close(); });
    });
  }

  // 列出某目录下的直接子项（文件+目录），返回 [{name, kind, handle}]
  function listDir(pathSegments) {
    return getDirHandle(pathSegments, false).then(function (dir) {
      var arr = [];
      return new Promise(function (resolve, reject) {
        // @ts-ignore - values() 异步迭代器
        var it = dir.values();
        function pump() {
          it.next().then(function (res) {
            if (res.done) { resolve(arr); return; }
            arr.push({ name: res.value.name, kind: res.value.kind, handle: res.value });
            pump();
          }, reject);
        }
        pump();
      });
    }).catch(function (err) {
      if (err && err.name === "NotFoundError") return [];
      throw err;
    });
  }

  // 判断某文件是否存在
  function exists(pathSegments, fileName) {
    return readFile(pathSegments, fileName).then(function (t) { return t !== null; }).catch(function () { return false; });
  }

  NS.fs = {
    supported: supported,
    pickDirectory: pickDirectory,
    restoreDirectory: restoreDirectory,
    verifyPermission: verifyPermission,
    getRoot: getRoot,
    clearRoot: clearRoot,
    getDirHandle: getDirHandle,
    readFile: readFile,
    writeFile: writeFile,
    listDir: listDir,
    exists: exists
  };
})(window);
