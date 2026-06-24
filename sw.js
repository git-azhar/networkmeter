// ── State ────────────────────────────────────────────────────────────────────
let state = {
  enabled: true,
  autoTest: false,
  lastDownBps: 0,
  lastUpBps: 0,
  lastPingMs: null,
  ringDownBps: Array(60).fill(0),
  ringUpBps:   Array(60).fill(0),
  ringPingMs:  Array(60).fill(0),
  ringIdx: 0,
  todayDown: 0,
  todayUp: 0,
  todayRequests: 0,
  lastResetDay: "",
  activeRequests: 0,
  speedTest: {
    running: false,
    lastDownMbps: null,
    lastUpMbps:   null,
    lastPingMs:   null,
    lastWhen:     null,
    error:        null
  },
  ipInfo: {
    ip: null, isp: null, city: null,
    region: null, country: null, flag: null,
    fetchedAt: null, fetching: false, error: null
  },
  testHistory: []   // last 20 manual/auto speed tests
}

let autoRunning   = false
let manualRunning = false

// ── Helpers ──────────────────────────────────────────────────────────────────
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function headerValue(headers, name) {
  if (!headers) return null
  const n = name.toLowerCase()
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === n) return h.value || null
  }
  return null
}

function clampNum(x)            { return (Number.isFinite(x) && x >= 0) ? x : 0 }
function clampInt(v,min,max,dv) { const n=Number(v); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):dv }

function qualityFromPingAndSpeed(pingMs, downMbps) {
  if (pingMs === null || pingMs <= 0) return null
  if (pingMs < 20  && downMbps >= 50)  return 'Excellent'
  if (pingMs < 50  && downMbps >= 10)  return 'Good'
  if (pingMs < 100 && downMbps >= 2)   return 'Fair'
  return 'Poor'
}

// ── Persist / Load ────────────────────────────────────────────────────────────
const CORE_KEYS = [
  'enabled','autoTest','todayDown','todayUp','todayRequests','lastResetDay',
  'ringDownBps','ringUpBps','ringPingMs','ringIdx',
  'lastDownBps','lastUpBps','lastPingMs','speedTest','ipInfo','testHistory'
]

async function loadSettings() {
  const r = await chrome.storage.local.get(CORE_KEYS)
  if (typeof r.enabled        === 'boolean') state.enabled        = r.enabled
  if (typeof r.autoTest       === 'boolean') state.autoTest       = r.autoTest
  if (typeof r.todayDown      === 'number')  state.todayDown      = r.todayDown
  if (typeof r.todayUp        === 'number')  state.todayUp        = r.todayUp
  if (typeof r.todayRequests  === 'number')  state.todayRequests  = r.todayRequests
  if (typeof r.lastResetDay   === 'string')  state.lastResetDay   = r.lastResetDay
  if (typeof r.lastDownBps    === 'number')  state.lastDownBps    = r.lastDownBps
  if (typeof r.lastUpBps      === 'number')  state.lastUpBps      = r.lastUpBps
  if (typeof r.lastPingMs     === 'number')  state.lastPingMs     = r.lastPingMs
  if (Array.isArray(r.ringDownBps) && r.ringDownBps.length === 60) state.ringDownBps = r.ringDownBps
  if (Array.isArray(r.ringUpBps)   && r.ringUpBps.length   === 60) state.ringUpBps   = r.ringUpBps
  if (Array.isArray(r.ringPingMs)  && r.ringPingMs.length  === 60) state.ringPingMs  = r.ringPingMs
  if (typeof r.ringIdx        === 'number')  state.ringIdx        = r.ringIdx
  if (r.speedTest  && typeof r.speedTest  === 'object') state.speedTest  = { ...state.speedTest,  ...r.speedTest  }
  if (r.ipInfo     && typeof r.ipInfo     === 'object') state.ipInfo     = { ...state.ipInfo,     ...r.ipInfo     }
  if (Array.isArray(r.testHistory)) state.testHistory = r.testHistory
  if (!state.lastResetDay) state.lastResetDay = dayKey()
}

async function saveCore() {
  await chrome.storage.local.set({
    enabled:       state.enabled,
    autoTest:      state.autoTest,
    todayDown:     state.todayDown,
    todayUp:       state.todayUp,
    todayRequests: state.todayRequests,
    lastResetDay:  state.lastResetDay,
    ringDownBps:   state.ringDownBps,
    ringUpBps:     state.ringUpBps,
    ringPingMs:    state.ringPingMs,
    ringIdx:       state.ringIdx,
    lastDownBps:   state.lastDownBps,
    lastUpBps:     state.lastUpBps,
    lastPingMs:    state.lastPingMs,
    speedTest:     state.speedTest,
    ipInfo:        state.ipInfo,
    testHistory:   state.testHistory
  })
}

// ── Offscreen ─────────────────────────────────────────────────────────────────
async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument()
  if (exists) return true
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_SCRAPING'],
    justification: 'Auto sampling scheduler.'
  })
  return chrome.offscreen.hasDocument()
}

// ── Badge ──────────────────────────────────────────────────────────────────────
let badgeToggle = false   // flip between speed and ping on badge
async function updateBadge() {
  if (!state.enabled) {
    await chrome.action.setBadgeText({ text: '' })
    return
  }

  let text = ''
  if (state.autoTest && state.lastPingMs && badgeToggle) {
    // Show ping on alternate ticks
    const p = Math.round(state.lastPingMs)
    text = p > 999 ? '999+' : `${p}ms`
    await chrome.action.setBadgeBackgroundColor({ color: '#1a3870' })
  } else if (state.lastDownBps > 0) {
    const mbps = (state.lastDownBps * 8) / 1_000_000
    text = mbps >= 100 ? String(Math.round(mbps)) : mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)
    await chrome.action.setBadgeBackgroundColor({ color: '#2b78ff' })
  }

  badgeToggle = !badgeToggle
  await chrome.action.setBadgeText({ text })
}

// ── Ring / tick ───────────────────────────────────────────────────────────────
async function tickRing(downBps, upBps, pingMs) {
  const dk = dayKey()
  if (dk !== state.lastResetDay) {
    state.lastResetDay  = dk
    state.todayDown     = 0
    state.todayUp       = 0
    state.todayRequests = 0
  }

  state.lastDownBps = clampNum(downBps)
  state.lastUpBps   = clampNum(upBps)
  if (pingMs !== null && pingMs > 0) state.lastPingMs = pingMs

  state.ringDownBps[state.ringIdx] = state.lastDownBps
  state.ringUpBps[state.ringIdx]   = state.lastUpBps
  state.ringPingMs[state.ringIdx]  = state.lastPingMs || 0

  state.ringIdx = (state.ringIdx + 1) % 60

  await saveCore()
  await updateBadge()
}

// ── Ping measurement ──────────────────────────────────────────────────────────
async function measurePing(samples = 3) {
  const url = `https://speed.cloudflare.com/__down?bytes=1&_=${Date.now()}`
  const times = []
  for (let i = 0; i < samples; i++) {
    try {
      const t0 = performance.now()
      await fetch(url, { cache: 'no-store' })
      times.push(performance.now() - t0)
    } catch {}
  }
  if (!times.length) return null
  times.sort((a,b) => a-b)
  // median
  return times[Math.floor(times.length / 2)]
}

// ── Speed test core ───────────────────────────────────────────────────────────
async function getCfg() {
  const r = await chrome.storage.local.get(['testSeconds','autoIntervalSec','autoSeconds','cfDownBytes','cfUpBytes'])
  return {
    testSeconds:     clampInt(r.testSeconds,    3,  30, 10),
    autoIntervalSec: clampInt(r.autoIntervalSec,3,  60, 10),
    autoSeconds:     clampInt(r.autoSeconds,    2,  10,  3),
    cfDownBytes:     clampInt(r.cfDownBytes,    250000, 20000000, 5000000),
    cfUpBytes:       clampInt(r.cfUpBytes,      100000, 10000000, 2000000)
  }
}

function measId()            { return `${Date.now()}-${Math.random().toString(16).slice(2)}` }
function makeDownUrl(b, id)  { return `https://speed.cloudflare.com/__down?bytes=${b}&measId=${encodeURIComponent(id)}&_=${Date.now()}` }
function makeUpUrl(id)       { return `https://speed.cloudflare.com/__up?measId=${encodeURIComponent(id)}&_=${Date.now()}` }

function randBytes(n) {
  const a = new Uint8Array(n)
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(a.subarray(i, Math.min(i+65536, n)))
  return a
}

async function cfDownloadBps(seconds, bytesPerReq, evtType) {
  const id = measId(), stopAt = performance.now() + seconds*1000
  let total=0, started=false, t0=0, lastEmit=0
  const emit = () => {
    if (!evtType || !started) return
    const now = performance.now()
    if (now - lastEmit < 120) return
    lastEmit = now
    chrome.runtime.sendMessage({ type: evtType, downBps: total / Math.max(0.001,(now-t0)/1000), upBps: null }).catch(()=>{})
  }
  while (performance.now() < stopAt) {
    const res = await fetch(makeDownUrl(bytesPerReq, id), { cache:'no-store' })
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    if (!res.body) {
      const ab = await res.arrayBuffer()
      if (!started) { started=true; t0=performance.now() }
      total += ab.byteLength; emit(); continue
    }
    const reader = res.body.getReader()
    while (performance.now() < stopAt) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) { if (!started){started=true;t0=performance.now()} total+=value.byteLength; emit() }
    }
    try { await reader.cancel() } catch {}
  }
  const dt = Math.max(0.001, started ? (performance.now()-t0)/1000 : seconds)
  return total / dt
}

async function cfUploadBps(seconds, bytesPerReq, evtType) {
  const id = measId(), stopAt = performance.now() + seconds*1000
  let total=0, started=false, t0=0, lastEmit=0
  const emit = () => {
    if (!evtType || !started) return
    const now = performance.now()
    if (now - lastEmit < 120) return
    lastEmit = now
    chrome.runtime.sendMessage({ type: evtType, downBps: null, upBps: total / Math.max(0.001,(now-t0)/1000) }).catch(()=>{})
  }
  const blob = new Blob([randBytes(bytesPerReq)], { type:'application/octet-stream' })
  while (performance.now() < stopAt) {
    const fd = new FormData(); fd.append('upload', blob, 'blob.bin')
    const res = await fetch(makeUpUrl(id), { method:'POST', body:fd, cache:'no-store' })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    if (!started) { started=true; t0=performance.now() }
    total += bytesPerReq; emit()
  }
  const dt = Math.max(0.001, started ? (performance.now()-t0)/1000 : seconds)
  return total / dt
}

// ── IP Info fetch ─────────────────────────────────────────────────────────────
// Provider adapters — each returns a normalised object or throws
const IP_PROVIDERS = [
  {
    name: 'ipwho.is',
    url:  'https://ipwho.is/',
    parse(d) {
      if (!d.success) throw new Error(d.message || 'Failed')
      return {
        ip:          d.ip,
        isp:         d.connection?.isp || d.connection?.org || null,
        city:        d.city            || null,
        region:      d.region          || null,
        country:     d.country         || null,
        countryCode: d.country_code    || null,
        timezone:    d.timezone?.id    || null,
      }
    }
  },
  {
    name: 'ip-api.com',
    url:  'http://ip-api.com/json/?fields=status,message,query,isp,org,city,regionName,country,countryCode,timezone',
    parse(d) {
      if (d.status !== 'success') throw new Error(d.message || 'Failed')
      return {
        ip:          d.query,
        isp:         d.isp || d.org || null,
        city:        d.city       || null,
        region:      d.regionName || null,
        country:     d.country    || null,
        countryCode: d.countryCode|| null,
        timezone:    d.timezone   || null,
      }
    }
  },
  {
    name: 'freeipapi.com',
    url:  'https://freeipapi.com/api/json',
    parse(d) {
      return {
        ip:          d.ipAddress,
        isp:         null,
        city:        d.cityName    || null,
        region:      d.regionName  || null,
        country:     d.countryName || null,
        countryCode: d.countryCode || null,
        timezone:    d.timeZone    || null,
      }
    }
  }
]

async function fetchIpInfo(force = false) {
  const cacheMs = 10 * 60 * 1000
  if (!force && state.ipInfo.fetchedAt && (Date.now() - state.ipInfo.fetchedAt) < cacheMs && state.ipInfo.ip) {
    return state.ipInfo
  }
  if (state.ipInfo.fetching) return state.ipInfo

  state.ipInfo.fetching = true
  state.ipInfo.error    = null

  let lastErr = 'All providers failed'

  for (const provider of IP_PROVIDERS) {
    try {
      const res = await fetch(provider.url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data    = await res.json()
      const parsed  = provider.parse(data)

      state.ipInfo = {
        ...parsed,
        flag:      parsed.countryCode
                     ? `https://flagcdn.com/24x18/${parsed.countryCode.toLowerCase()}.png`
                     : null,
        fetchedAt: Date.now(),
        fetching:  false,
        error:     null,
        provider:  provider.name
      }
      await saveCore()
      return state.ipInfo
    } catch(e) {
      lastErr = `${provider.name}: ${e.message || e}`
      // try next provider
    }
  }

  // All failed
  state.ipInfo.fetching = false
  state.ipInfo.error    = lastErr
  await saveCore()
  return state.ipInfo
}

// ── webRequest listeners (real traffic tracking) ──────────────────────────────
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!state.enabled || !details?.method) return
    state.activeRequests++
    if (['POST','PUT','PATCH'].includes(details.method) && details.requestBody?.raw) {
      let bytes = 0
      for (const part of details.requestBody.raw) if (part.bytes) bytes += part.bytes.byteLength
      state.todayUp       += bytes
      state.todayRequests++
    }
  },
  { urls: ['<all_urls>'] }, ['requestBody']
)

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!state.enabled) return
    state.activeRequests = Math.max(0, state.activeRequests - 1)
    const cl    = headerValue(details.responseHeaders, 'content-length')
    const bytes = cl ? parseInt(cl, 10) : 0
    if (Number.isFinite(bytes) && bytes > 0) {
      state.todayDown     += bytes
      state.todayRequests++
    }
  },
  { urls: ['<all_urls>'] }, ['responseHeaders']
)

chrome.webRequest.onErrorOccurred.addListener(
  () => { state.activeRequests = Math.max(0, state.activeRequests - 1) },
  { urls: ['<all_urls>'] }
)

// ── Message handler ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    try {
      if (!msg || typeof msg !== 'object') { sendResponse({ ok:false, error:'Bad message' }); return }

      switch (msg.type) {

        case 'GET_STATE':
          sendResponse({ ok:true, ...state })
          break

        case 'GET_AUTO_CFG': {
          const cfg = await getCfg()
          sendResponse({ ok:true, autoIntervalSec: cfg.autoIntervalSec })
          break
        }

        case 'SET_ENABLED':
          state.enabled = !!msg.enabled
          if (!state.enabled) await chrome.action.setBadgeText({ text:'' })
          await saveCore()
          sendResponse({ ok:true })
          break

        case 'RESET_TODAY':
          state.todayDown     = 0
          state.todayUp       = 0
          state.todayRequests = 0
          state.lastResetDay  = dayKey()
          await saveCore()
          sendResponse({ ok:true })
          break

        case 'SET_AUTO_TEST':
          state.autoTest = !!msg.autoTest
          await saveCore()
          if (state.autoTest) {
            const ok = await ensureOffscreen()
            if (ok) chrome.runtime.sendMessage({ type:'AUTO_WAKE' }).catch(()=>{})
            else state.autoTest = false
          }
          await updateBadge()
          await saveCore()
          sendResponse({ ok:true })
          break

        case 'AUTO_SAMPLE':
          sendResponse(await runAutoSample())
          break

        case 'RUN_SPEED_TEST':
          sendResponse(await runSpeedTest())
          break

        case 'GET_IP_INFO':
          sendResponse({ ok:true, ipInfo: await fetchIpInfo(!!msg.force) })
          break

        case 'MEASURE_PING': {
          const pingMs = await measurePing(5)
          sendResponse({ ok:true, pingMs })
          break
        }

        default:
          sendResponse({ ok:false, error:'Unknown type' })
      }
    } catch(e) {
      sendResponse({ ok:false, error: String(e?.message ?? e) })
    }
  })()
  return true
})

// ── Auto sample & speed test ──────────────────────────────────────────────────
async function runAutoSample() {
  if (!state.enabled || !state.autoTest)  return { ok:true, skipped:true }
  if (autoRunning || manualRunning)       return { ok:true, skipped:true }
  autoRunning = true
  try {
    const cfg    = await getCfg()
    const pingMs = await measurePing(3)
    const downBps = await cfDownloadBps(cfg.autoSeconds, cfg.cfDownBytes, 'AUTO_PROGRESS')
    const upBps   = await cfUploadBps(cfg.autoSeconds, cfg.cfUpBytes,   'AUTO_PROGRESS')
    await tickRing(downBps, upBps, pingMs)
    autoRunning = false
    return { ok:true }
  } catch(e) {
    autoRunning = false
    return { ok:false, error: String(e?.message ?? e) }
  }
}

async function runSpeedTest() {
  if (state.speedTest.running) return { ok:false, error:'Already running' }
  if (manualRunning)           return { ok:false, error:'Already running' }

  manualRunning = true
  state.speedTest = { running:true, lastDownMbps:state.speedTest.lastDownMbps,
    lastUpMbps:state.speedTest.lastUpMbps, lastPingMs:state.speedTest.lastPingMs,
    lastWhen:state.speedTest.lastWhen, error:null }
  await saveCore()

  try {
    const cfg     = await getCfg()
    const pingMs  = await measurePing(5)
    const downBps = await cfDownloadBps(cfg.testSeconds, cfg.cfDownBytes, 'SPEED_PROGRESS')
    const upBps   = await cfUploadBps(cfg.testSeconds,   cfg.cfUpBytes,   'SPEED_PROGRESS')

    const downMbps = (downBps * 8) / 1_000_000
    const upMbps   = (upBps   * 8) / 1_000_000

    state.speedTest = { running:false, lastDownMbps:downMbps, lastUpMbps:upMbps,
      lastPingMs:pingMs, lastWhen:Date.now(), error:null }

    // Add to history (keep last 20)
    state.testHistory.unshift({
      when:     Date.now(),
      downMbps: Math.round(downMbps * 100) / 100,
      upMbps:   Math.round(upMbps   * 100) / 100,
      pingMs:   pingMs ? Math.round(pingMs) : null,
      quality:  qualityFromPingAndSpeed(pingMs, downMbps)
    })
    if (state.testHistory.length > 20) state.testHistory.length = 20

    await tickRing(downBps, upBps, pingMs)
    await saveCore()
    manualRunning = false
    return { ok:true, downMbps, upMbps, pingMs }
  } catch(e) {
    state.speedTest = { running:false, lastDownMbps:state.speedTest.lastDownMbps,
      lastUpMbps:state.speedTest.lastUpMbps, lastPingMs:state.speedTest.lastPingMs,
      lastWhen:state.speedTest.lastWhen, error:String(e?.message ?? e) }
    await saveCore()
    manualRunning = false
    return { ok:false, error: state.speedTest.error }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings()
  if (state.autoTest) {
    const ok = await ensureOffscreen()
    if (!ok) state.autoTest = false
    else chrome.runtime.sendMessage({ type:'AUTO_WAKE' }).catch(()=>{})
  }
  await updateBadge()
  await saveCore()
  // Fetch IP info in background (don't block init)
  fetchIpInfo().catch(()=>{})
}

;(async () => { await init() })()
chrome.runtime.onInstalled.addListener(async () => { await init() })
chrome.runtime.onStartup.addListener(async () => { await init() })
