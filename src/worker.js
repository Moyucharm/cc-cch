import xxhash from 'xxhash-wasm'
import { computeCch, parseProxyUrl } from './src/cch.js'

const MAX_RETRIES = 3
const TIMEOUT = 120000

let h64Raw = null
let initPromise = null

async function ensureInit() {
  if (h64Raw) return h64Raw
  if (!initPromise) {
    initPromise = xxhash().then(api => {
      h64Raw = api.h64Raw
      return h64Raw
    })
  }
  return initPromise
}

async function forwardWithRetry(targetUrl, options, body, retryCount = 0) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT)

  try {
    const response = await fetch(targetUrl, {
      ...options,
      body,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    return response
  } catch (err) {
    clearTimeout(timeoutId)
    if (retryCount < MAX_RETRIES && (err.name === 'AbortError' || err.message.includes('fetch'))) {
      console.error(`[CCH-PROXY] Retry ${retryCount + 1}/${MAX_RETRIES}`)
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)))
      return forwardWithRetry(targetUrl, options, body, retryCount + 1)
    }
    throw err
  }
}

export default {
  async fetch(request, env, ctx) {
    await ensureInit()

    const url = new URL(request.url)
    const targetUrl = parseProxyUrl(url.pathname + url.search)

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Invalid proxy URL format. Use: /proxy/<encoded-url>/path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const rawBody = await request.text()
    let processedBody = rawBody
    let cch = null

    if (rawBody && request.method === 'POST') {
      const result = computeCch(rawBody, h64Raw)
      processedBody = result.body
      cch = result.cch
      if (result.injected) {
        console.log(`[CCH-PROXY] ${request.method} -> ${targetUrl} | cch=${cch}`)
      }
    } else {
      console.log(`[CCH-PROXY] ${request.method} -> ${targetUrl}`)
    }

    const upstreamHeaders = new Headers(request.headers)
    upstreamHeaders.delete('host')
    upstreamHeaders.delete('content-length')

    try {
      const upstreamRes = await forwardWithRetry(targetUrl, {
        method: request.method,
        headers: upstreamHeaders
      }, processedBody || null)

      const responseHeaders = new Headers(upstreamRes.headers)
      responseHeaders.delete('transfer-encoding')

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: responseHeaders
      })
    } catch (err) {
      console.error(`[CCH-PROXY] Error: ${err.message}`)
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }
}
