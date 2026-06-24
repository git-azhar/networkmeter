let state = {
  enabled: true,
  autoTest: false,
  lastDownBps: 0,
  lastUpBps: 0,
  ringDownBps: Array(60).fill(0),
  ringUpBps: Array(60).fill(0),
  ringIdx: 0,
  todayDown: 0,
  todayUp: 0,
  lastResetDay: "",
  speedTest: { running: false, lastDownMbps: null, lastUpMbps: null, lastWhen: null, error: null }
}

let autoRunning = false
let manualRunning = false

function dayKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${da}`
}

function headerValue(headers, name) {
  if (!headers) return null
  const n = name.toLowerCase()
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === n) return h.value || null
  }
  return null
}

function clampNum(x) {
  if (!Number.isFinite(x) || x < 0) return 0
  return x
}

function clampInt(v, min, max, defv) {
  const n = Number(v)
  if (!Number.isFinite(n)) return defv
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

async function loadSettings() {
  const r = await chrome.storage.local.get([
    "enabled",
    "autoTest",
    "todayDown",
    "todayUp",
    "lastResetDay",
    "ringDownBps",
    "ringUpBps",
    "ringIdx",
    "speedTest",
    "lastDownBps",
    "lastUpBps"
  ])
  if (typeof r.enabled === "boolean") state.enabled = r.enabled
  if (typeof r.autoTest === "boolean") state.autoTest = r.autoTest
  if (typeof r.todayDown === "number") state.todayDown = r.todayDown
  if (typeof r.todayUp === "number") state.todayUp = r.todayUp
  if (typeof r.lastResetDay === "string") state.lastResetDay = r.lastResetDay
  if (Array.isArray(r.ringDownBps) && r.ringDownBps.length === 60) state.ringDownBps = r.ringDownBps
  if (Array.isArray(r.ringUpBps) && r.ringUpBps.length === 60) state.ringUpBps = r.ringUpBps
  if (typeof r.ringIdx === "number") state.ringIdx = r.ringIdx
  if (typeof r.lastDownBps === "number") state.lastDownBps = r.lastDownBps
  if (typeof r.lastUpBps === "number") state.lastUpBps = r.lastUpBps
  if (r.speedTest && typeof r.speedTest === "object") state.speedTest = { ...state.speedTest, ...r.speedTest }
  if (!state.lastResetDay) state.lastResetDay = dayKey()
}

async function saveCore() {
  await chrome.storage.local.set({
    enabled: state.enabled,
    autoTest: state.autoTest,
    todayDown: state.todayDown,
    todayUp: state.todayUp,
    lastResetDay: state.lastResetDay,
    ringDownBps: state.ringDownBps,
    ringUpBps: state.ringUpBps,
    ringIdx: state.ringIdx,
    speedTest: state.speedTest,
    lastDownBps: state.lastDownBps,
    lastUpBps: state.lastUpBps
  })
}

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument()
  if (exists) return true
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_SCRAPING"],
    justification: "Auto sampling scheduler."
  })
  return await chrome.offscreen.hasDocument()
}

async function setBadgeFromDownBps() {
  let text = ""
  if (state.enabled && state.lastDownBps > 0) {
    const mbps = (state.lastDownBps * 8) / 1_000_000
    text = mbps >= 100 ? String(Math.round(mbps)) : mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)
  }
  await chrome.action.setBadgeText({ text })
  await chrome.action.setBadgeBackgroundColor({ color: "#2b78ff" })
}



async function tickRingFromSample(downBps, upBps) {
  const dk = dayKey()
  if (dk !== state.lastResetDay) {
    state.lastResetDay = dk
    state.todayDown = 0
    state.todayUp = 0
  }

  state.lastDownBps = clampNum(downBps)
  state.lastUpBps = clampNum(upBps)

  state.ringDownBps[state.ringIdx] = state.lastDownBps
  state.ringUpBps[state.ringIdx] = state.lastUpBps
  state.ringIdx = (state.ringIdx + 1) % 60

  await saveCore()
  await setBadgeFromDownBps()
}

async function getCfg() {
  const r = await chrome.storage.local.get([
    "testSeconds",
    "autoIntervalSec",
    "autoSeconds",
    "cfDownBytes",
    "cfUpBytes"
  ])
  const testSeconds = clampInt(r.testSeconds, 3, 30, 10)
  const autoIntervalSec = clampInt(r.autoIntervalSec, 3, 60, 10)
  const autoSeconds = clampInt(r.autoSeconds, 2, 10, 3)
  const cfDownBytes = clampInt(r.cfDownBytes, 250000, 20000000, 5000000)
  const cfUpBytes = clampInt(r.cfUpBytes, 100000, 10000000, 2000000)
  return { testSeconds, autoIntervalSec, autoSeconds, cfDownBytes, cfUpBytes }
}

function measId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function makeDownUrl(bytes, id) {
  return `https://speed.cloudflare.com/__down?bytes=${bytes}&measId=${encodeURIComponent(id)}&_=${Date.now()}`
}

function makeUpUrl(id) {
  return `https://speed.cloudflare.com/__up?measId=${encodeURIComponent(id)}&_=${Date.now()}`
}

function randBytes(n) {
  const a = new Uint8Array(n)
  const max = 65536
  for (let i = 0; i < n; i += max) {
    crypto.getRandomValues(a.subarray(i, Math.min(i + max, n)))
  }
  return a
}


async function cfDownloadBps(seconds, bytesPerReq, evtType) {
  const id = measId()
  const stopAt = performance.now() + seconds * 1000
  let total = 0
  let started = false
  let t0 = 0
  let lastEmitAt = 0

  const emit = () => {
    if (!evtType || !started) return
    const now = performance.now()
    if (now - lastEmitAt < 120) return
    lastEmitAt = now
    const dt = Math.max(0.001, (now - t0) / 1000)
    const bps = total / dt
    chrome.runtime.sendMessage({ type: evtType, downBps: bps, upBps: null }).catch(() => {})
  }

  while (performance.now() < stopAt) {
    const url = makeDownUrl(bytesPerReq, id)
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    if (!res.body) {
      const ab = await res.arrayBuffer()
      if (!started) {
        started = true
        t0 = performance.now()
      }
      total += ab.byteLength
      emit()
      continue
    }

    const reader = res.body.getReader()
    while (performance.now() < stopAt) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        if (!started) {
          started = true
          t0 = performance.now()
        }
        total += value.byteLength
        emit()
      }
    }
    try { await reader.cancel() } catch {}
  }

  const t1 = performance.now()
  const dt = Math.max(0.001, started ? (t1 - t0) / 1000 : seconds)
  return total / dt
}

async function cfUploadBps(seconds, bytesPerReq, evtType) {
  const id = measId()
  const stopAt = performance.now() + seconds * 1000
  let total = 0
  let started = false
  let t0 = 0
  let lastEmitAt = 0

  const emit = () => {
    if (!evtType || !started) return
    const now = performance.now()
    if (now - lastEmitAt < 120) return
    lastEmitAt = now
    const dt = Math.max(0.001, (now - t0) / 1000)
    const bps = total / dt
    chrome.runtime.sendMessage({ type: evtType, downBps: null, upBps: bps }).catch(() => {})
  }

  const payload = randBytes(bytesPerReq)
  const blob = new Blob([payload], { type: "application/octet-stream" })

  while (performance.now() < stopAt) {
    const fd = new FormData()
    fd.append("upload", blob, "blob.bin")

    const res = await fetch(makeUpUrl(id), { method: "POST", body: fd, cache: "no-store" })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)

    if (!started) {
      started = true
      t0 = performance.now()
    }

    total += bytesPerReq
    emit()
  }

  const t1 = performance.now()
  const dt = Math.max(0.001, started ? (t1 - t0) / 1000 : seconds)
  return total / dt
}

;(async () => {
  await loadSettings()
  if (state.autoTest) {
    const ok = await ensureOffscreen()
    if (!ok) state.autoTest = false
    else chrome.runtime.sendMessage({ type: "AUTO_WAKE" }).catch(() => {})
  }
  await setBadgeFromDownBps()
  await saveCore()
})()

chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings()
  if (state.autoTest) {
    const ok = await ensureOffscreen()
    if (!ok) state.autoTest = false
    else chrome.runtime.sendMessage({ type: "AUTO_WAKE" }).catch(() => {})
  }
  await setBadgeFromDownBps()
  await saveCore()
})

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings()
  if (state.autoTest) {
    const ok = await ensureOffscreen()
    if (!ok) state.autoTest = false
    else chrome.runtime.sendMessage({ type: "AUTO_WAKE" }).catch(() => {})
  }
  await setBadgeFromDownBps()
  await saveCore()
})

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!state.enabled) return
    if (!details || !details.method) return
    if (details.method === "POST" || details.method === "PUT" || details.method === "PATCH") {
      if (details.requestBody) {
        let bytes = 0
        if (details.requestBody.raw) {
          for (const part of details.requestBody.raw) {
            if (part.bytes) bytes += part.bytes.byteLength
          }
        }
        state.todayUp += bytes
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
)

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!state.enabled) return
    const cl = headerValue(details.responseHeaders, "content-length")
    const bytes = cl ? parseInt(cl, 10) : 0
    if (Number.isFinite(bytes) && bytes > 0) state.todayDown += bytes
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    try {
      if (!msg || typeof msg !== "object") {
        sendResponse({ ok: false, error: "Bad message" })
        return
      }

      if (msg.type === "GET_STATE") {
        sendResponse({ ok: true, ...state })
        return
      }

      if (msg.type === "GET_AUTO_CFG") {
        const cfg = await getCfg()
        sendResponse({ ok: true, autoIntervalSec: cfg.autoIntervalSec })
        return
      }

      if (msg.type === "SET_ENABLED") {
        state.enabled = !!msg.enabled
        await saveCore()
        sendResponse({ ok: true })
        return
      }

      if (msg.type === "RESET_TODAY") {
        state.todayDown = 0
        state.todayUp = 0
        state.lastResetDay = dayKey()
        await saveCore()
        sendResponse({ ok: true })
        return
      }

      if (msg.type === "SET_AUTO_TEST") {
        state.autoTest = !!msg.autoTest
        await saveCore()
        if (state.autoTest) {
          const ok = await ensureOffscreen()
          if (ok) chrome.runtime.sendMessage({ type: "AUTO_WAKE" }).catch(() => {})
          else state.autoTest = false
        }
        await setBadgeFromDownBps()
        await saveCore()
        sendResponse({ ok: true })
        return
      }

      if (msg.type === "AUTO_SAMPLE") {
        const r = await runAutoSample()
        sendResponse(r)
        return
      }

      if (msg.type === "RUN_SPEED_TEST") {
        const r = await runSpeedTest()
        sendResponse(r)
        return
      }

      sendResponse({ ok: false, error: "Unknown type" })
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
    }
  })()
  return true
})

async function runAutoSample() {
  if (!state.enabled || !state.autoTest) return { ok: true, skipped: true }
  if (autoRunning || manualRunning) return { ok: true, skipped: true }
  autoRunning = true
  try {
    const cfg = await getCfg()
    const downBps = await cfDownloadBps(cfg.autoSeconds, cfg.cfDownBytes, "AUTO_PROGRESS")
    const upBps = await cfUploadBps(cfg.autoSeconds, cfg.cfUpBytes, "AUTO_PROGRESS")
    await tickRingFromSample(downBps, upBps)
    autoRunning = false
    return { ok: true }
  } catch (e) {
    autoRunning = false
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

async function runSpeedTest() {
  if (state.speedTest.running) return { ok: false, error: "Already running" }
  if (manualRunning) return { ok: false, error: "Already running" }

  manualRunning = true
  state.speedTest = {
    running: true,
    lastDownMbps: state.speedTest.lastDownMbps,
    lastUpMbps: state.speedTest.lastUpMbps,
    lastWhen: state.speedTest.lastWhen,
    error: null
  }
  await saveCore()

  try {
    const cfg = await getCfg()
    const downBps = await cfDownloadBps(cfg.testSeconds, cfg.cfDownBytes, "SPEED_PROGRESS")
    const upBps = await cfUploadBps(cfg.testSeconds, cfg.cfUpBytes, "SPEED_PROGRESS")

    state.speedTest = {
      running: false,
      lastDownMbps: (downBps * 8) / 1_000_000,
      lastUpMbps: (upBps * 8) / 1_000_000,
      lastWhen: Date.now(),
      error: null
    }

    await tickRingFromSample(downBps, upBps)
    await saveCore()
    manualRunning = false
    return { ok: true, downMbps: state.speedTest.lastDownMbps, upMbps: state.speedTest.lastUpMbps }
  } catch (e) {
    state.speedTest = {
      running: false,
      lastDownMbps: state.speedTest.lastDownMbps,
      lastUpMbps: state.speedTest.lastUpMbps,
      lastWhen: state.speedTest.lastWhen,
      error: String(e && e.message ? e.message : e)
    }
    await saveCore()
    manualRunning = false
    return { ok: false, error: state.speedTest.error }
  }
}
