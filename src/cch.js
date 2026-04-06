const SEED = 0x6E52736AC806831En
const CCH_PLACEHOLDER = 'cch=00000'
const CCH_PATTERN = /cch=[0-9a-f]{5}/gi

export const SEED_VALUE = SEED
export const CCH_PLACEHOLDER_VALUE = CCH_PLACEHOLDER

export function computeCch(bodyString, h64Raw) {
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

  const bytes = new TextEncoder().encode(bodyWithPlaceholder)
  const hash = h64Raw(bytes, SEED)
  const cchValue = (hash & 0xFFFFFn).toString(16).padStart(5, '0')

  const finalBody = bodyWithPlaceholder.replace(CCH_PLACEHOLDER, `cch=${cchValue}`)

  return { body: finalBody, injected: true, cch: cchValue }
}

export function parseProxyUrl(url) {
  const urlMatch = url.match(/^\/proxy\/([^/]+)(\/.*)?$/)
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

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
