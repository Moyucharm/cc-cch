import http from 'http'
import https from 'https'
import { URL } from 'url'
import xxhash from 'xxhash-wasm'

const PORT = parseInt(process.env.CCH_PROXY_PORT) || 9876
const SEED = 0x6E52736AC806831En
const MAX_RETRIES = parseInt(process.env.CCH_MAX_RETRIES) || 3
const TIMEOUT = parseInt(process.env.CCH_TIMEOUT) || 120000
const CCH_PLACEHOLDER = 'cch=00000'
const CCH_PATTERN = /cch=[0-9a-f]{5}/gi

let h64Raw = null

async function init() {
  const xxhashApi = await xxhash()
  h64Raw = xxhashApi.h64Raw
  console.log(`[CCH-PROXY] Initialized on port ${PORT}`)
  console.log(`[CCH-PROXY] Seed: 0x${SEED.toString(16)}`)
}

function computeCch(bodyString) {
  const systemIdx = bodyString.indexOf('"system":[')
  if (systemIdx === -1) {
    return { body: bodyString, injected: false }
  }

  const searchEnd = Math.min(systemIdx + 300, bodyString.length)
  const searchRegion = bodyString.slice(systemIdx, searchEnd)
  const cchMatch = searchRegion.match(CCH_PATTERN)

  let bodyWithPlaceholder

  if (!cchMatch) {
    const textValueStart = bodyString.indexOf('"text":"', systemIdx)
    if (textValueStart === -1) {
      return { body: bodyString, injected: false }
    }
    const injectPos = textValueStart + '"text":"'.length
    bodyWithPlaceholder = bodyString.slice(0, injectPos) + CCH_PLACEHOLDER + '\\n' + bodyString.slice(injectPos)
  } else {
    const absMatchIdx = systemIdx + cchMatch.index
    bodyWithPlaceholder = bodyString.slice(0, absMatchIdx) + CCH_PLACEHOLDER + bodyString.slice(absMatchIdx + 9)
  }

  const bytes = Buffer.from(bodyWithPlaceholder, 'utf-8')
  const hash = h64Raw(bytes, SEED)
  const cchValue = (hash & 0xFFFFFn).toString(16).padStart(5, '0')

  const finalBody = bodyWithPlaceholder.replace(CCH_PLACEHOLDER, `cch=${cchValue}`)

  return { body: finalBody, injected: true, cch: cchValue }
}

function parseProxyUrl(reqUrl) {
  const urlMatch = reqUrl.match(/^\/proxy\/([^/]+)(\/.*)?$/)
  if (!urlMatch) {
    return null
  }

  let targetBase
  try {
    targetBase = decodeURIComponent(urlMatch[1])
  } catch (e) {
    return null
  }

  const pathSuffix = urlMatch[2] || '/messages'
  const targetUrl = targetBase.replace(/\/+$/, '') + pathSuffix

  return targetUrl
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function forwardRequest(targetUrl, options, body, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl)
    const protocol = parsedUrl.protocol === 'https:' ? https : http

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers: {
        ...options.headers,
        host: parsedUrl.hostname,
        'content-length': Buffer.byteLength(body)
      },
      timeout: TIMEOUT
    }

    const req = protocol.request(reqOptions, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks)
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: responseBody
        })
      })
    })

    req.on('error', async (err) => {
      if (retryCount < MAX_RETRIES) {
        console.error(`[CCH-PROXY] Request error (retry ${retryCount + 1}/${MAX_RETRIES}): ${err.message}`)
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
        console.error(`[CCH-PROXY] Timeout (retry ${retryCount + 1}/${MAX_RETRIES})`)
        await sleep(1000 * (retryCount + 1))
        try {
          const result = await forwardRequest(targetUrl, options, body, retryCount + 1)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      } else {
        reject(new Error('Request timeout after max retries'))
      }
    })

    req.write(body)
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

  if (!rawBody) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Empty request body' }))
    return
  }

  const { body: processedBody, injected, cch } = computeCch(rawBody)

  if (injected) {
    console.log(`[CCH-PROXY] Injected cch=${cch}`)
  }

  const upstreamHeaders = { ...req.headers }
  delete upstreamHeaders['host']
  delete upstreamHeaders['content-length']

  try {
    const upstreamRes = await forwardRequest(targetUrl, {
      method: req.method,
      headers: upstreamHeaders
    }, processedBody)

    if (upstreamRes.statusCode >= 500 && upstreamRes.body.length === 0) {
      console.error(`[CCH-PROXY] Empty response with status ${upstreamRes.statusCode}`)
    }

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
    console.log(`[CCH-PROXY] Server running at http://127.0.0.1:${PORT}`)
    console.log(`[CCH-PROXY] Usage: http://127.0.0.1:${PORT}/proxy/<encoded-target-url>/messages`)
  })

  process.on('SIGINT', () => {
    console.log('\n[CCH-PROXY] Shutting down...')
    server.close(() => {
      console.log('[CCH-PROXY] Server closed')
      process.exit(0)
    })
  })
}

main().catch(err => {
  console.error('[CCH-PROXY] Fatal error:', err)
  process.exit(1)
})
