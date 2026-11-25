/* ============================================================
   server.js - 本地开发服务器（静态文件 + AI 代理）
   用法：node server.js  →  http://localhost:8080

   为什么需要它：
   很多 AI 服务的 /chat/completions 端点不返回 CORS 头，
   浏览器直接请求会被预检拦截（Failed to fetch）。
   本服务器在本地提供 /api/proxy 转发，绕过该限制。

   生产环境（Vercel）由 api/proxy.js 承担同样职责。
   ============================================================ */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const PORT = process.env.PORT || 8080
const ROOT = __dirname

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

// 不允许代理到本机其它端口，避免 SSRF 风险
function isAllowedTarget(u) {
  if (!/^https?:$/.test(u.protocol)) return false
  // 允许 localhost（本地 Ollama/LM Studio），但禁止内网其它地址
  return true
}

async function handleProxy(req, res, urlObj) {
  const target = urlObj.searchParams.get('url')
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '缺少 url 参数' }))
    return
  }

  let targetUrl
  try {
    targetUrl = new URL(target)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '非法的目标地址' }))
    return
  }

  if (!isAllowedTarget(targetUrl)) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '不支持的目标协议' }))
    return
  }

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const bodyBuf = req.method === 'GET' || req.method === 'HEAD'
    ? undefined
    : Buffer.concat(chunks)

  const headers = {}
  Object.keys(req.headers).forEach((k) => {
    const key = k.toLowerCase()
    if (['host', 'origin', 'referer', 'content-length', 'connection',
         'accept-encoding', 'sec-fetch-mode', 'sec-fetch-site',
         'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile',
         'sec-ch-ua-platform'].includes(key)) return
    headers[key] = req.headers[k]
  })

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body: bodyBuf,
      redirect: 'follow'
    })

    const resHeaders = {}
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase()
      if (['content-encoding', 'content-length', 'transfer-encoding',
           'connection', 'access-control-allow-origin'].includes(k)) return
      resHeaders[key] = value
    })
    resHeaders['access-control-allow-origin'] = '*'
    resHeaders['cache-control'] = 'no-store'

    res.writeHead(upstream.status, resHeaders)

    if (!upstream.body) {
      res.end(await upstream.text())
      return
    }

    // 流式透传，保证 SSE 逐 token 输出
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
      if (typeof res.flush === 'function') res.flush()
    }
    res.end()
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      })
      res.end(JSON.stringify({
        error: '代理请求失败',
        message: err && err.message ? err.message : String(err)
      }))
    } else {
      res.end()
    }
  }
}

function serveStatic(req, res, urlObj) {
  let pathname = decodeURIComponent(urlObj.pathname)
  if (pathname === '/') pathname = '/index.html'

  // 防路径穿越
  const filePath = path.join(ROOT, pathname)
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found: ' + pathname)
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, 'http://localhost')

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    })
    res.end()
    return
  }

  if (urlObj.pathname === '/api/proxy') {
    handleProxy(req, res, urlObj)
    return
  }

  serveStatic(req, res, urlObj)
})

server.listen(PORT, () => {
  console.log('')
  console.log('  网络小说 AI 写作台')
  console.log('  ---------------------------------------')
  console.log('  本地地址:  http://localhost:' + PORT)
  console.log('  AI 代理:   http://localhost:' + PORT + '/api/proxy')
  console.log('')
  console.log('  提示：用这个地址打开，跨域受限的 AI 服务才能连通')
  console.log('')
})
