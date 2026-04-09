import xxhash from 'npm:xxhash-wasm'
import { computeCch, parseProxyUrl } from './src/cch.js'
import { buildUpstreamHeaders } from './src/upstream-headers.js'

const PORT = Deno.env.get('CCH_PROXY_PORT') || 9876
const MAX_RETRIES = parseInt(Deno.env.get('CCH_MAX_RETRIES')) || 3
const TIMEOUT = parseInt(Deno.env.get('CCH_TIMEOUT')) || 120000

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
    if (retryCount < MAX_RETRIES) {
      console.error(`[CCH-PROXY] Retry ${retryCount + 1}/${MAX_RETRIES}: ${err.message}`)
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)))
      return forwardWithRetry(targetUrl, options, body, retryCount + 1)
    }
    throw err
  }
}

async function handler(req) {
  await ensureInit()

  const url = new URL(req.url)
  const targetUrl = parseProxyUrl(url.pathname + url.search)

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Invalid proxy URL format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const rawBody = await req.text()
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

  const upstreamHeaders = buildUpstreamHeaders(req.headers)

  try {
    const upstreamRes = await forwardWithRetry(targetUrl, {
      method: req.method,
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

console.log(`[CCH-PROXY] Deno server starting on port ${PORT}...`)

Deno.serve({ port: parseInt(PORT), hostname: '127.0.0.1' }, handler)
