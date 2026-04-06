import http from 'http'
import https from 'https'
import { URL } from 'url'
import xxhash from 'xxhash-wasm'
import { computeCch, parseProxyUrl, sleep } from './src/cch.js'

const PORT = parseInt(process.env.CCH_PROXY_PORT) || 9876
const MAX_RETRIES = parseInt(process.env.CCH_MAX_RETRIES) || 3
const TIMEOUT = parseInt(process.env.CCH_TIMEOUT) || 120000

let h64Raw = null

async function init() {
  const xxhashApi = await xxhash()
  h64Raw = xxhashApi.h64Raw
  console.log(`[CCH-PROXY] Node.js server initialized on port ${PORT}`)
}

function forwardRequest(targetUrl, options, body, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl)
    const protocol = parsedUrl.protocol === 'https:' ? https : http

    const headers = { ...options.headers, host: parsedUrl.hostname }
    if (body) {
      headers['content-length'] = Buffer.byteLength(body)
    }

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers,
      timeout: TIMEOUT
    }

    const req = protocol.request(reqOptions, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        })
      })
    })

    req.on('error', async (err) => {
      if (retryCount < MAX_RETRIES) {
        console.error(`[CCH-PROXY] Retry ${retryCount + 1}/${MAX_RETRIES}: ${err.message}`)
        await sleep(1000 * (retryCount + 1))
        try {
          const result = await forwardRequest(targetUrl, options, body, retryCount + 1)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      } else {
        reject(err)
      }
    })

    req.on('timeout', async () => {
      req.destroy()
      if (retryCount < MAX_RETRIES) {
        console.error(`[CCH-PROXY] Timeout, retry ${retryCount + 1}/${MAX_RETRIES}`)
        await sleep(1000 * (retryCount + 1))
        try {
          const result = await forwardRequest(targetUrl, options, body, retryCount + 1)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      } else {
        reject(new Error('Timeout after max retries'))
      }
    })

    if (body) {
      req.write(body)
    }
    req.end()
  })
}

async function handleRequest(req, res) {
  const targetUrl = parseProxyUrl(req.url)

  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid proxy URL format. Use: /proxy/<encoded-url>/path' }))
    return
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const rawBody = Buffer.concat(chunks).toString('utf-8')

  let processedBody = rawBody
  let cch = null

  if (rawBody && req.method === 'POST') {
    const result = computeCch(rawBody, h64Raw)
    processedBody = result.body
    cch = result.cch
    if (result.injected) {
      console.log(`[CCH-PROXY] ${req.method} -> ${targetUrl} | cch=${cch}`)
    }
  } else {
    console.log(`[CCH-PROXY] ${req.method} -> ${targetUrl}`)
  }

  const upstreamHeaders = { ...req.headers }
  delete upstreamHeaders['host']
  delete upstreamHeaders['content-length']

  try {
    const upstreamRes = await forwardRequest(targetUrl, {
      method: req.method,
      headers: upstreamHeaders
    }, processedBody || null)

    const responseHeaders = { ...upstreamRes.headers }
    delete responseHeaders['transfer-encoding']

    res.writeHead(upstreamRes.statusCode, responseHeaders)
    res.end(upstreamRes.body)
  } catch (err) {
    console.error(`[CCH-PROXY] Error: ${err.message}`)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  }
}

async function main() {
  await init()

  const server = http.createServer(handleRequest)

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CCH-PROXY] Running at http://127.0.0.1:${PORT}`)
    console.log(`[CCH-PROXY] Usage: /proxy/<encoded-target-url>/messages`)
  })

  process.on('SIGINT', () => {
    console.log('\n[CCH-PROXY] Shutting down...')
    server.close(() => process.exit(0))
  })
}

main().catch(err => {
  console.error('[CCH-PROXY] Fatal:', err)
  process.exit(1)
})
