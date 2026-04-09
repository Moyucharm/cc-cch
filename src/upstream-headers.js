export const CLAUDE_CODE_UPSTREAM_HEADERS = {
  'Anthropic-Beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
  'Anthropic-Version': '2023-06-01',
  'Anthropic-Dangerous-Direct-Browser-Access': 'true',
  'X-App': 'cli',
  'X-Stainless-Helper-Method': 'stream',
  'X-Stainless-Retry-Count': '0',
  'X-Stainless-Runtime-Version': 'v24.3.0',
  'X-Stainless-Package-Version': '0.55.1',
  'X-Stainless-Runtime': 'node',
  'X-Stainless-Lang': 'js',
  'X-Stainless-Arch': 'arm64',
  'X-Stainless-Os': 'MacOS',
  'X-Stainless-Timeout': '60',
  'User-Agent': 'claude-cli/2.1.34 (external, cli)',
  'Connection': 'keep-alive',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept': 'text/event-stream'
}

const PASSTHROUGH_HEADER_NAME_MAP = {
  authorization: 'Authorization',
  'x-api-key': 'X-API-Key',
  'content-type': 'Content-Type'
}

function normalizeHeaderValue(value) {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return null
}

function readHeader(inputHeaders, name) {
  if (!inputHeaders) {
    return null
  }

  if (typeof inputHeaders.get === 'function') {
    return normalizeHeaderValue(inputHeaders.get(name))
  }

  const targetName = name.toLowerCase()
  for (const [headerName, value] of Object.entries(inputHeaders)) {
    if (headerName.toLowerCase() === targetName) {
      return normalizeHeaderValue(value)
    }
  }

  return null
}

export function buildUpstreamHeaders(inputHeaders) {
  const headers = { ...CLAUDE_CODE_UPSTREAM_HEADERS }

  for (const [headerName, outputHeaderName] of Object.entries(PASSTHROUGH_HEADER_NAME_MAP)) {
    const value = readHeader(inputHeaders, headerName)
    if (value) {
      headers[outputHeaderName] = value
    }
  }

  return headers
}
