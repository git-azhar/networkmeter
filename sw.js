// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  enabled:        true,
  autoTest:       false,
  lastDownBps:    0,
  lastUpBps:      0,
  lastPingMs:     null,
  lastJitterMs:   null,
  peakDownBps:    0,
  peakUpBps:      0,
  uptimeStart:    null,
  ringDownBps:    Array(60).fill(0),
  ringUpBps:      Array(60).fill(0),
  ringPingMs:     Array(60).fill(0),
  ringIdx:        0,
  todayDown:      0,
  todayUp:        0,
  todayRequests:  0,
  lastResetDay:   '',
  activeRequests: 0,
  speedTest: {
    running:      false,
    lastDownMbps: null,
    lastUpMbps:   null,
    lastPingMs:   null,
    lastJitterMs: null,
    lastWhen:     null,
    error:        null
  },
  ipInfo: {
    ip: null, isp: null, city: null, region: null,
    country: null, countryCode: null, flag: null,
    timezone: null, fetchedAt: null, fetching: false,
    error: null, provider: null
  },
  ispHistory:   [],   // [{ip, isp, country, detectedAt}] — last 10 changes
  testHistory:  [],   // last 20 speed tests
  weeklyStats:  {},   // { 'YYYY-MM-DD': { downMbps, upMbps, pingMs, samples } }
  alerts: {
    enabled:        false,
    thresholdMbps:  10,
    lastFiredAt:    null,
    cooldownMin:    5
  }
}

let autoRunning   = false
let manualRunning = false

// ── Helpers ───────────────────────────────────────────────────────────────────
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function headerValue(headers, name) {
  if (!headers) return null
  const n = name.toLowerCase()
  for (const h of headers) {
    if (h.name?.toLowerCase() === n) return h.value || null
  }
  return null
}

function clampNum(x)            { return (Number.isFinite(x) && x >= 0) ? x : 0 }
function clampInt(v,mn,mx,dv)   { const n=Number(v); return Number.isFinite(n)?Math.max(mn,Math.min(mx,Math.trunc(n))):dv }

function qualityFromPingAndSpeed(pingMs, downMbps) {
  if (!pingMs || pingMs <= 0) return null
  if (pingMs < 20  && downMbps >= 50)  return 'Excellent'
  if (pingMs < 50  && downMbps >= 10)  return 'Good'
  if (pingMs < 100 && downMbps >= 2)   return 'Fair'
  return 'Poor'
}

// ── Storage ───────────────────────────────────────────────────────────────────
const CORE_KEYS = [
  'enabled','autoTest','todayDown','todayUp','todayRequests','lastResetDay',
  'ringDownBps','ringUpBps','ringPingMs','ringIdx',
  'lastDownBps','lastUpBps','lastPingMs','lastJitterMs',
  'peakDownBps','peakUpBps','uptimeStart',
  'speedTest','ipInfo','ispHistory','testHistory','weeklyStats','alerts'
]

async function loadSettings() {
  const r = await chrome.storage.local.get(CORE_KEYS)
  const b = (k) => typeof r[k] === 'boolean'
  const n = (k) => typeof r[k] === 'number'
  const s = (k) => typeof r[k] === 'string'
  const a = (k, len) => Array.isArray(r[k]) && (!len || r[k].length === len)

  if (b('enabled'))       state.enabled       = r.enabled
  if (b('autoTest'))      state.autoTest      = r.autoTest
  if (n('todayDown'))     state.todayDown     = r.todayDown
  if (n('todayUp'))       state.todayUp       = r.todayUp
  if (n('todayRequests')) state.todayRequests = r.todayRequests
  if (s('lastResetDay'))  state.lastResetDay  = r.lastResetDay
  if (n('lastDownBps'))   state.lastDownBps   = r.lastDownBps
  if (n('lastUpBps'))     state.lastUpBps     = r.lastUpBps
  if (n('lastPingMs'))    state.lastPingMs    = r.lastPingMs
  if (n('lastJitterMs'))  state.lastJitterMs  = r.lastJitterMs
  if (n('peakDownBps'))   state.peakDownBps   = r.peakDownBps
  if (n('peakUpBps'))     state.peakUpBps     = r.peakUpBps
  if (n('uptimeStart'))   state.uptimeStart   = r.uptimeStart
  if (a('ringDownBps',60)) state.ringDownBps  = r.ringDownBps
  if (a('ringUpBps',60))   state.ringUpBps    = r.ringUpBps
  if (a('ringPingMs',60))  state.ringPingMs   = r.ringPingMs
  if (n('ringIdx'))       state.ringIdx       = r.ringIdx
  if (r.speedTest  && typeof r.speedTest  === 'object') state.speedTest  = { ...state.speedTest,  ...r.speedTest  }
  if (r.ipInfo     && typeof r.ipInfo     === 'object') state.ipInfo     = { ...state.ipInfo,     ...r.ipInfo     }
  if (r.alerts     && typeof r.alerts     === 'object') state.alerts     = { ...state.alerts,     ...r.alerts     }
  if (a('ispHistory'))    state.ispHistory    = r.ispHistory
  if (a('testHistory'))   state.testHistory   = r.testHistory
  if (r.weeklyStats && typeof r.weeklyStats === 'object') state.weeklyStats = r.weeklyStats
  if (!state.lastResetDay) state.lastResetDay = dayKey()
  if (!state.uptimeStart && state.enabled)   state.uptimeStart  = Date.now()
}

async function saveCore() {
  await chrome.storage.local.set({
    enabled: state.enabled, autoTest: state.autoTest,
    todayDown: state.todayDown, todayUp: state.todayUp,
    todayRequests: state.todayRequests, lastResetDay: state.lastResetDay,
    ringDownBps: state.ringDownBps, ringUpBps: state.ringUpBps,
    ringPingMs: state.ringPingMs, ringIdx: state.ringIdx,
    lastDownBps: state.lastDownBps, lastUpBps: state.lastUpBps,
    lastPingMs: state.lastPingMs, lastJitterMs: state.lastJitterMs,
    peakDownBps: state.peakDownBps, peakUpBps: state.peakUpBps,
    uptimeStart: state.uptimeStart,
    speedTest: state.speedTest, ipInfo: state.ipInfo,
    alerts: state.alerts, ispHistory: state.ispHistory,
    testHistory: state.testHistory, weeklyStats: state.weeklyStats
  })
}

// ── Offscreen ─────────────────────────────────────────────────────────────────
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return true
  await chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['DOM_SCRAPING'],
    justification: 'Auto sampling scheduler.'
  })
  return chrome.offscreen.hasDocument()
}

// ── Badge ─────────────────────────────────────────────────────────────────────
let badgeToggle = false
async function updateBadge() {
  if (!state.enabled) { await chrome.action.setBadgeText({ text: '' }); return }
  let text = '', color = '#2b78ff'
  if (state.autoTest && state.lastPingMs && badgeToggle) {
    const p = Math.round(state.lastPingMs)
    text  = p > 999 ? '999+' : `${p}ms`
    color = '#1a3870'
  } else if (state.lastDownBps > 0) {
    const mbps = (state.lastDownBps * 8) / 1_000_000
    text = mbps >= 100 ? String(Math.round(mbps)) : mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)
    // Color by quality
    if (state.lastPingMs) {
      if (state.lastPingMs < 20)       color = '#4ecfa0'
      else if (state.lastPingMs < 50)  color = '#2b78ff'
      else if (state.lastPingMs < 100) color = '#f5a623'
      else                             color = '#e05252'
    }
  }
  badgeToggle = !badgeToggle
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
}

// ── Slow-speed alert ──────────────────────────────────────────────────────────
async function checkSpeedAlert(downMbps) {
  if (!state.alerts.enabled) return
  const threshold = state.alerts.thresholdMbps || 10
  if (downMbps >= threshold) return
  const cooldownMs = (state.alerts.cooldownMin || 5) * 60 * 1000
  if (state.alerts.lastFiredAt && (Date.now() - state.alerts.lastFiredAt) < cooldownMs) return

  state.alerts.lastFiredAt = Date.now()
  await saveCore()

  chrome.notifications.create(`nm-slow-${Date.now()}`, {
    type:    'basic',
    iconUrl: 'icons/icon128.png',
    title:   'Network Meter — Slow Speed',
    message: `Download speed dropped to ${downMbps.toFixed(1)} Mbps (threshold: ${threshold} Mbps)`
  })
}

// ── Weekly stats update ───────────────────────────────────────────────────────
function updateWeeklyStats(downMbps, pingMs) {
  const key = dayKey()
  const existing = state.weeklyStats[key] || { downSum:0, upSum:0, pingSum:0, samples:0 }
  existing.downSum  = (existing.downSum  || 0) + downMbps
  existing.pingSum  = (existing.pingSum  || 0) + (pingMs || 0)
  existing.samples  = (existing.samples  || 0) + 1
  existing.downMbps = existing.downSum / existing.samples
  existing.pingMs   = existing.pingSum / existing.samples
  state.weeklyStats[key] = existing

  // Keep only last 7 days
  const keys = Object.keys(state.weeklyStats).sort()
  while (keys.length > 7) {
    delete state.weeklyStats[keys.shift()]
  }
}

// ── Ring / tick ───────────────────────────────────────────────────────────────
async function tickRing(downBps, upBps, pingMs, jitterMs) {
  const dk = dayKey()
  if (dk !== state.lastResetDay) {
    state.lastResetDay  = dk
    state.todayDown     = 0
    state.todayUp       = 0
    state.todayRequests = 0
    state.peakDownBps   = 0
    state.peakUpBps     = 0
  }

  state.lastDownBps  = clampNum(downBps)
  state.lastUpBps    = clampNum(upBps)
  if (pingMs   != null && pingMs   > 0) state.lastPingMs   = pingMs
  if (jitterMs != null && jitterMs > 0) state.lastJitterMs = jitterMs

  // Peak tracking
  if (state.lastDownBps > state.peakDownBps) state.peakDownBps = state.lastDownBps
  if (state.lastUpBps   > state.peakUpBps)   state.peakUpBps   = state.lastUpBps

  state.ringDownBps[state.ringIdx] = state.lastDownBps
  state.ringUpBps[state.ringIdx]   = state.lastUpBps
  state.ringPingMs[state.ringIdx]  = state.lastPingMs || 0
  state.ringIdx = (state.ringIdx + 1) % 60

  const downMbps = (state.lastDownBps * 8) / 1_000_000
  updateWeeklyStats(downMbps, pingMs)
  await checkSpeedAlert(downMbps)
  await saveCore()
  await updateBadge()
}

// ── Ping + jitter measurement ─────────────────────────────────────────────────
async function measurePingAndJitter(samples = 5) {
  const url = `https://speed.cloudflare.com/__down?bytes=1&_=${Date.now()}`
  const times = []
  for (let i = 0; i < samples; i++) {
    try {
      const t0 = performance.now()
      await fetch(url, { cache: 'no-store' })
      times.push(performance.now() - t0)
    } catch {}
    if (i < samples - 1) await new Promise(r => setTimeout(r, 100))
  }
  if (!times.length) return { pingMs: null, jitterMs: null }
  times.sort((a,b) => a-b)
  const pingMs = times[Math.floor(times.length / 2)]  // median
  // Jitter = mean absolute deviation from median
  const jitterMs = times.reduce((s,v) => s + Math.abs(v - pingMs), 0) / times.length
  return { pingMs, jitterMs }
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

function measId()           { return `${Date.now()}-${Math.random().toString(16).slice(2)}` }
function makeDownUrl(b, id) { return `https://speed.cloudflare.com/__down?bytes=${b}&measId=${encodeURIComponent(id)}&_=${Date.now()}` }
function makeUpUrl(id)      { return `https://speed.cloudflare.com/__up?measId=${encodeURIComponent(id)}&_=${Date.now()}` }

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
    chrome.runtime.sendMessage({ type:evtType, downBps: total/Math.max(0.001,(now-t0)/1000), upBps:null }).catch(()=>{})
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
  return total / Math.max(0.001, started ? (performance.now()-t0)/1000 : seconds)
}

async function cfUploadBps(seconds, bytesPerReq, evtType) {
  const id = measId(), stopAt = performance.now() + seconds*1000
  let total=0, started=false, t0=0, lastEmit=0
  const emit = () => {
    if (!evtType || !started) return
    const now = performance.now()
    if (now - lastEmit < 120) return
    lastEmit = now
    chrome.runtime.sendMessage({ type:evtType, downBps:null, upBps: total/Math.max(0.001,(now-t0)/1000) }).catch(()=>{})
  }
  const blob = new Blob([randBytes(bytesPerReq)], { type:'application/octet-stream' })
  while (performance.now() < stopAt) {
    const fd = new FormData(); fd.append('upload', blob, 'blob.bin')
    const res = await fetch(makeUpUrl(id), { method:'POST', body:fd, cache:'no-store' })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    if (!started) { started=true; t0=performance.now() }
    total += bytesPerReq; emit()
  }
  return total / Math.max(0.001, started ? (performance.now()-t0)/1000 : seconds)
}

// ── IP Info + ISP change detection ───────────────────────────────────────────
const IP_PROVIDERS = [
  {
    name: 'ipwho.is', url: 'https://ipwho.is/',
    parse(d) {
      if (!d.success) throw new Error(d.message || 'Failed')
      return { ip:d.ip, isp:d.connection?.isp||d.connection?.org||null, city:d.city||null,
               region:d.region||null, country:d.country||null, countryCode:d.country_code||null, timezone:d.timezone?.id||null }
    }
  },
  {
    name: 'ip-api.com', url: 'http://ip-api.com/json/?fields=status,message,query,isp,org,city,regionName,country,countryCode,timezone',
    parse(d) {
      if (d.status !== 'success') throw new Error(d.message || 'Failed')
      return { ip:d.query, isp:d.isp||d.org||null, city:d.city||null,
               region:d.regionName||null, country:d.country||null, countryCode:d.countryCode||null, timezone:d.timezone||null }
    }
  },
  {
    name: 'freeipapi.com', url: 'https://freeipapi.com/api/json',
    parse(d) {
      return { ip:d.ipAddress, isp:null, city:d.cityName||null,
               region:d.regionName||null, country:d.countryName||null, countryCode:d.countryCode||null, timezone:d.timeZone||null }
    }
  }
]

async function fetchIpInfo(force = false) {
  const cacheMs = 10 * 60 * 1000
  if (!force && state.ipInfo.fetchedAt && (Date.now()-state.ipInfo.fetchedAt) < cacheMs && state.ipInfo.ip) return state.ipInfo
  if (state.ipInfo.fetching) return state.ipInfo

  state.ipInfo.fetching = true
  state.ipInfo.error    = null
  let lastErr = 'All providers failed'

  for (const provider of IP_PROVIDERS) {
    try {
      const res    = await fetch(provider.url, { cache:'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = provider.parse(await res.json())

      // ISP change detection
      const prevIp  = state.ipInfo.ip
      const prevIsp = state.ipInfo.isp
      if (prevIp && (prevIp !== parsed.ip || prevIsp !== parsed.isp)) {
        state.ispHistory.unshift({
          ip: parsed.ip, isp: parsed.isp||'Unknown',
          country: parsed.country||null, detectedAt: Date.now(),
          prevIp, prevIsp: prevIsp||'Unknown'
        })
        if (state.ispHistory.length > 10) state.ispHistory.length = 10

        // Notify on IP/ISP change
        chrome.notifications.create(`nm-isp-${Date.now()}`, {
          type: 'basic', iconUrl: 'icons/icon128.png',
          title: 'Network Meter — Network Changed',
          message: `IP changed to ${parsed.ip}${parsed.isp ? ` (${parsed.isp})` : ''}`
        })
      }

      state.ipInfo = {
        ...parsed,
        flag:      parsed.countryCode ? `https://flagcdn.com/24x18/${parsed.countryCode.toLowerCase()}.png` : null,
        fetchedAt: Date.now(), fetching: false, error: null, provider: provider.name
      }
      await saveCore()
      return state.ipInfo
    } catch(e) {
      lastErr = `${provider.name}: ${e.message||e}`
    }
  }

  state.ipInfo.fetching = false
  state.ipInfo.error    = lastErr
  await saveCore()
  return state.ipInfo
}

// ── webRequest ────────────────────────────────────────────────────────────────
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!state.enabled || !details?.method) return
    state.activeRequests++
    if (['POST','PUT','PATCH'].includes(details.method) && details.requestBody?.raw) {
      let bytes = 0
      for (const p of details.requestBody.raw) if (p.bytes) bytes += p.bytes.byteLength
      state.todayUp += bytes; state.todayRequests++
    }
  },
  { urls:['<all_urls>'] }, ['requestBody']
)
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!state.enabled) return
    state.activeRequests = Math.max(0, state.activeRequests-1)
    const cl = headerValue(details.responseHeaders, 'content-length')
    const bytes = cl ? parseInt(cl,10) : 0
    if (Number.isFinite(bytes) && bytes > 0) { state.todayDown += bytes; state.todayRequests++ }
  },
  { urls:['<all_urls>'] }, ['responseHeaders']
)
chrome.webRequest.onErrorOccurred.addListener(
  () => { state.activeRequests = Math.max(0, state.activeRequests-1) },
  { urls:['<all_urls>'] }
)

// ── Message handler ───────────────────────────────────────────────────────────
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
          if (state.enabled && !state.uptimeStart) state.uptimeStart = Date.now()
          if (!state.enabled) { state.uptimeStart = null; await chrome.action.setBadgeText({ text:'' }) }
          await saveCore(); sendResponse({ ok:true })
          break

        case 'RESET_TODAY':
          state.todayDown=0; state.todayUp=0; state.todayRequests=0
          state.peakDownBps=0; state.peakUpBps=0; state.lastResetDay=dayKey()
          await saveCore(); sendResponse({ ok:true })
          break

        case 'SET_AUTO_TEST':
          state.autoTest = !!msg.autoTest
          await saveCore()
          if (state.autoTest) {
            const ok = await ensureOffscreen()
            if (ok) chrome.runtime.sendMessage({ type:'AUTO_WAKE' }).catch(()=>{})
            else state.autoTest = false
          }
          await updateBadge(); await saveCore(); sendResponse({ ok:true })
          break

        case 'SET_ALERTS':
          state.alerts = { ...state.alerts, ...msg.alerts }
          await saveCore(); sendResponse({ ok:true })
          break

        case 'AUTO_SAMPLE':
          sendResponse(await runAutoSample()); break

        case 'RUN_SPEED_TEST':
          sendResponse(await runSpeedTest()); break

        case 'GET_IP_INFO':
          sendResponse({ ok:true, ipInfo: await fetchIpInfo(!!msg.force) }); break

        case 'MEASURE_PING': {
          const r = await measurePingAndJitter(7)
          sendResponse({ ok:true, ...r }); break
        }

        case 'GET_WEEKLY_STATS':
          sendResponse({ ok:true, weeklyStats: state.weeklyStats }); break

        case 'GET_ISP_HISTORY':
          sendResponse({ ok:true, ispHistory: state.ispHistory }); break

        case 'EXPORT_CSV':
          sendResponse({ ok:true, csv: buildCsv() }); break

        default:
          sendResponse({ ok:false, error:'Unknown type' })
      }
    } catch(e) {
      sendResponse({ ok:false, error: String(e?.message??e) })
    }
  })()
  return true
})

// ── CSV export ────────────────────────────────────────────────────────────────
function buildCsv() {
  const lines = ['Timestamp,Download (Mbps),Upload (Mbps),Ping (ms),Jitter (ms),Quality']
  for (const h of state.testHistory) {
    lines.push([
      new Date(h.when).toISOString(),
      h.downMbps ?? '', h.upMbps ?? '',
      h.pingMs ?? '', h.jitterMs ?? '',
      h.quality ?? ''
    ].join(','))
  }
  lines.push('')
  lines.push('Date,Avg Download (Mbps),Avg Ping (ms),Samples')
  for (const [date, s] of Object.entries(state.weeklyStats).sort()) {
    lines.push([date, (s.downMbps||0).toFixed(2), (s.pingMs||0).toFixed(1), s.samples||0].join(','))
  }
  return lines.join('\n')
}

// ── Auto sample & manual test ─────────────────────────────────────────────────
async function runAutoSample() {
  if (!state.enabled || !state.autoTest) return { ok:true, skipped:true }
  if (autoRunning || manualRunning)      return { ok:true, skipped:true }
  autoRunning = true
  try {
    const cfg = await getCfg()
    const { pingMs, jitterMs } = await measurePingAndJitter(3)
    const downBps = await cfDownloadBps(cfg.autoSeconds, cfg.cfDownBytes, 'AUTO_PROGRESS')
    const upBps   = await cfUploadBps(cfg.autoSeconds, cfg.cfUpBytes,   'AUTO_PROGRESS')
    await tickRing(downBps, upBps, pingMs, jitterMs)
    autoRunning = false
    return { ok:true }
  } catch(e) {
    autoRunning = false
    return { ok:false, error: String(e?.message??e) }
  }
}

async function runSpeedTest() {
  if (state.speedTest.running) return { ok:false, error:'Already running' }
  if (manualRunning)           return { ok:false, error:'Already running' }

  manualRunning = true
  state.speedTest = { running:true, lastDownMbps:state.speedTest.lastDownMbps,
    lastUpMbps:state.speedTest.lastUpMbps, lastPingMs:state.speedTest.lastPingMs,
    lastJitterMs:state.speedTest.lastJitterMs, lastWhen:state.speedTest.lastWhen, error:null }
  await saveCore()

  try {
    const cfg     = await getCfg()
    const { pingMs, jitterMs } = await measurePingAndJitter(7)
    const downBps = await cfDownloadBps(cfg.testSeconds, cfg.cfDownBytes, 'SPEED_PROGRESS')
    const upBps   = await cfUploadBps(cfg.testSeconds,   cfg.cfUpBytes,   'SPEED_PROGRESS')
    const downMbps = (downBps*8)/1_000_000
    const upMbps   = (upBps*8)/1_000_000

    state.speedTest = { running:false, lastDownMbps:downMbps, lastUpMbps:upMbps,
      lastPingMs:pingMs, lastJitterMs:jitterMs, lastWhen:Date.now(), error:null }

    state.testHistory.unshift({
      when: Date.now(),
      downMbps: Math.round(downMbps*100)/100,
      upMbps:   Math.round(upMbps*100)/100,
      pingMs:   pingMs   ? Math.round(pingMs)   : null,
      jitterMs: jitterMs ? Math.round(jitterMs) : null,
      quality:  qualityFromPingAndSpeed(pingMs, downMbps)
    })
    if (state.testHistory.length > 20) state.testHistory.length = 20

    await tickRing(downBps, upBps, pingMs, jitterMs)
    await saveCore()
    manualRunning = false
    return { ok:true, downMbps, upMbps, pingMs, jitterMs }
  } catch(e) {
    state.speedTest = { ...state.speedTest, running:false, error:String(e?.message??e) }
    await saveCore()
    manualRunning = false
    return { ok:false, error: state.speedTest.error }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings()
  if (!state.uptimeStart && state.enabled) state.uptimeStart = Date.now()
  if (state.autoTest) {
    const ok = await ensureOffscreen()
    if (!ok) state.autoTest = false
    else chrome.runtime.sendMessage({ type:'AUTO_WAKE' }).catch(()=>{})
  }
  await updateBadge()
  await saveCore()
  fetchIpInfo().catch(()=>{})
}

;(async () => { await init() })()
chrome.runtime.onInstalled.addListener(async () => { await init() })
chrome.runtime.onStartup.addListener(async () => { await init() })
