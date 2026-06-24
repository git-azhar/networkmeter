// ── Formatters ────────────────────────────────────────────────────────────────
function fmtBps(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return '0 b/s'
  const units = ['b/s','Kb/s','Mb/s','Gb/s']
  let v = bps * 8, i = 0
  while (v >= 1000 && i < units.length-1) { v /= 1000; i++ }
  return `${v.toFixed(v>=100?0:v>=10?1:2)} ${units[i]}`
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B','KB','MB','GB','TB']
  let v = bytes, i = 0
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++ }
  return `${v.toFixed(v>=100?0:v>=10?1:2)} ${units[i]}`
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return '—'
  return n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n)
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
  return sameDay ? time : `${d.toLocaleDateString([],{month:'short',day:'numeric'})} ${time}`
}

function orderedRing(arr, idx) {
  const out = []
  for (let i = 0; i < arr.length; i++) out.push(arr[(idx+i) % arr.length])
  return out
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function drawChart(canvas, down, up, ping) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const pad = 8
  const iW = W - pad*2, iH = H - pad*2
  const maxSpeed = Math.max(1, ...down, ...up)
  const maxPing  = Math.max(1, ...ping)

  // Grid lines
  ctx.globalAlpha = 0.12
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= 4; i++) {
    const y = pad + (iH * i) / 4
    ctx.moveTo(pad, y); ctx.lineTo(pad+iW, y)
  }
  ctx.stroke()
  ctx.globalAlpha = 1

  const plotLine = (series, maxV, stroke, alpha=0.9) => {
    if (series.every(v => v === 0)) return
    ctx.beginPath()
    ctx.globalAlpha = alpha
    for (let i = 0; i < series.length; i++) {
      const x = pad + (iW * i) / (series.length-1)
      const y = pad + iH - (iH * series[i]) / maxV
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.8
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Filled area under download
  const downArr = down
  ctx.beginPath()
  ctx.globalAlpha = 0.08
  for (let i = 0; i < downArr.length; i++) {
    const x = pad + (iW * i) / (downArr.length-1)
    const y = pad + iH - (iH * downArr[i]) / maxSpeed
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.lineTo(pad+iW, pad+iH); ctx.lineTo(pad, pad+iH); ctx.closePath()
  ctx.fillStyle = '#2b78ff'; ctx.fill()
  ctx.globalAlpha = 1

  plotLine(down, maxSpeed, 'rgba(120,170,255,0.95)')
  plotLine(up,   maxSpeed, 'rgba(125,255,204,0.9)')
  plotLine(ping, maxPing,  'rgba(255,210,80,0.85)', 0.75)
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)
const toggle       = $('toggle')
const autoBtn      = $('autoBtn')
const autoState    = $('autoState')
const downEl       = $('down')
const upEl         = $('up')
const sub          = $('sub')
const badgeHint    = $('badgeHint')
const pingVal      = $('pingVal')
const qualityVal   = $('qualityVal')
const activeReqs   = $('activeReqs')
const speedTestBtn = $('speedTestBtn')
const resetBtn     = $('resetBtn')
const todayDown    = $('todayDown')
const todayUp      = $('todayUp')
const todayReqs    = $('todayReqs')
const canvas       = $('chart')
const status       = $('status')
const verEl        = $('ver')
const openOptions  = $('openOptions')

// Network tab
const refreshIpBtn = $('refreshIpBtn')
const ipInfoArea   = $('ipInfoArea')
const pingBigVal   = $('pingBigVal')
const pingTestBtn  = $('pingTestBtn')
const pingStatus   = $('pingStatus')
const connActive   = $('connActive')
const connToday    = $('connToday')
const connDown     = $('connDown')
const connUp       = $('connUp')

// History tab
const historyList     = $('historyList')
const clearHistoryBtn = $('clearHistoryBtn')

// ── Version ───────────────────────────────────────────────────────────────────
try { verEl.textContent = `v${chrome.runtime.getManifest().version}` } catch {}

openOptions?.addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage() })

// ── Tabs ──────────────────────────────────────────────────────────────────────
let activeTab = 'speed'
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b===btn))
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${activeTab}`))
    if (activeTab === 'network') loadIpInfo()
    if (activeTab === 'history') renderHistory(lastState?.testHistory || [])
  })
})

// ── Live speed during tests ───────────────────────────────────────────────────
let liveDown = null, liveUp = null, liveTimer = null

function setLive(d, u) {
  if (Number.isFinite(d)) liveDown = d
  if (Number.isFinite(u)) liveUp   = u
  if (liveTimer) return
  liveTimer = setTimeout(() => {
    if (Number.isFinite(liveDown)) downEl.textContent = fmtBps(liveDown)
    if (Number.isFinite(liveUp))   upEl.textContent   = fmtBps(liveUp)
    liveTimer = null
  }, 100)
}

chrome.runtime.onMessage.addListener(msg => {
  if (!msg?.type) return
  if (msg.type === 'SPEED_PROGRESS') {
    if (Number.isFinite(msg.downBps)) setLive(msg.downBps, null)
    if (Number.isFinite(msg.upBps))   setLive(null, msg.upBps)
    status.textContent = 'Manual test running…'
  }
  if (msg.type === 'AUTO_PROGRESS') {
    if (Number.isFinite(msg.downBps)) setLive(msg.downBps, null)
    if (Number.isFinite(msg.upBps))   setLive(null, msg.upBps)
  }
})

// ── Main refresh ──────────────────────────────────────────────────────────────
let lastState = null

async function refresh() {
  const r = await chrome.runtime.sendMessage({ type:'GET_STATE' })
  if (!r?.ok) { status.textContent = r?.error || 'Service worker not responding'; return }
  lastState = r

  // Toggle
  toggle.checked = !!r.enabled

  // Speed
  if (!Number.isFinite(liveDown)) downEl.textContent = fmtBps(r.lastDownBps)
  if (!Number.isFinite(liveUp))   upEl.textContent   = fmtBps(r.lastUpBps)

  // Ping
  if (r.lastPingMs) {
    pingVal.textContent = `${Math.round(r.lastPingMs)} ms`
  }

  // Quality
  const downMbps = (r.lastDownBps * 8) / 1_000_000
  const quality  = getQuality(r.lastPingMs, downMbps)
  qualityVal.textContent = quality || '—'
  qualityVal.className   = `pingNum quality-${quality || ''}`

  // Active requests
  activeReqs.textContent = `${r.activeRequests || 0} req`

  // Auto
  autoState.textContent  = r.autoTest ? 'ON' : 'OFF'
  autoBtn.textContent    = r.autoTest ? 'Stop Auto' : 'Start Auto'
  autoBtn.classList.toggle('active-pill', !!r.autoTest)

  // Badge hint
  const mbps = (r.lastDownBps * 8) / 1_000_000
  badgeHint.textContent = r.autoTest
    ? `Badge: ${mbps.toFixed(mbps>=10?1:2)} Mbps`
    : 'Badge: off'

  // Sub
  sub.textContent = r.autoTest ? 'Auto monitoring active' : 'Monitoring off'

  // Usage
  todayDown.textContent = fmtBytes(r.todayDown)
  todayUp.textContent   = fmtBytes(r.todayUp)
  todayReqs.textContent = fmtNum(r.todayRequests || 0)

  // Chart
  const down = orderedRing(r.ringDownBps || Array(60).fill(0), r.ringIdx||0)
  const up   = orderedRing(r.ringUpBps   || Array(60).fill(0), r.ringIdx||0)
  const ping = orderedRing(r.ringPingMs  || Array(60).fill(0), r.ringIdx||0)
  drawChart(canvas, down, up, ping)

  // Speed test status
  if (r.speedTest?.running) {
    status.textContent = 'Manual test running…'
  } else if (r.speedTest?.error) {
    status.textContent = `Error: ${r.speedTest.error}`
  } else if (r.speedTest?.lastDownMbps != null) {
    const p = r.speedTest.lastPingMs ? ` · Ping ${Math.round(r.speedTest.lastPingMs)}ms` : ''
    status.textContent = `Last: ↓${r.speedTest.lastDownMbps.toFixed(1)} ↑${r.speedTest.lastUpMbps.toFixed(1)} Mbps${p}`
  } else if (!status.textContent || status.textContent === 'Manual test running…') {
    status.textContent = ''
  }

  // Network tab (if visible)
  if (activeTab === 'network') {
    connActive.textContent = `${r.activeRequests || 0}`
    connToday.textContent  = fmtNum(r.todayRequests || 0)
    connDown.textContent   = fmtBytes(r.todayDown)
    connUp.textContent     = fmtBytes(r.todayUp)
    if (r.lastPingMs) pingBigVal.textContent = Math.round(r.lastPingMs)
  }

  // History tab (if visible)
  if (activeTab === 'history') renderHistory(r.testHistory || [])
}

function getQuality(pingMs, downMbps) {
  if (!pingMs || pingMs <= 0) return null
  if (pingMs < 20  && downMbps >= 50)  return 'Excellent'
  if (pingMs < 50  && downMbps >= 10)  return 'Good'
  if (pingMs < 100 && downMbps >= 2)   return 'Fair'
  return 'Poor'
}

// ── IP Info ───────────────────────────────────────────────────────────────────
async function loadIpInfo(force = false) {
  ipInfoArea.innerHTML = '<div class="ipLoading">Fetching IP info…</div>'
  const r = await chrome.runtime.sendMessage({ type:'GET_IP_INFO', force })
  renderIpInfo(r?.ipInfo)
}

function renderIpInfo(info) {
  if (!info || info.fetching) {
    ipInfoArea.innerHTML = '<div class="ipLoading">Fetching…</div>'
    return
  }
  if (info.error && !info.ip) {
    ipInfoArea.innerHTML = `<div class="ipError">Failed to fetch IP info: ${info.error}</div>`
    return
  }

  const flagHtml = info.flag
    ? `<img class="flagImg" src="${info.flag}" alt="${info.countryCode||''}">`
    : ''

  const rows = [
    { k:'IP Address', v:`<span class="ipValBlue">${info.ip||'—'}</span>` },
    { k:'ISP / Org',  v: info.isp     || '—' },
    { k:'City',       v: info.city    || '—' },
    { k:'Region',     v: info.region  || '—' },
    { k:'Country',    v: `${flagHtml}${info.country||'—'}` },
    { k:'Timezone',   v: info.timezone|| '—' },
    { k:'Source',     v: `<span style="color:rgba(238,243,255,0.4);font-size:11px">${info.provider||'—'}</span>` },
  ]

  ipInfoArea.innerHTML = rows.map(row => `
    <div class="ipRow">
      <span class="ipKey">${row.k}</span>
      <span class="ipVal">${row.v}</span>
    </div>
  `).join('')
}

// ── History ───────────────────────────────────────────────────────────────────
function renderHistory(history) {
  if (!history?.length) {
    historyList.innerHTML = '<div class="historyEmpty">No tests recorded yet.<br>Run a speed test to start.</div>'
    return
  }
  historyList.innerHTML = history.map(h => `
    <div class="historyItem">
      <div>
        <div class="historyMain">
          <span class="historyDown">↓ ${h.downMbps} Mbps</span>
          <span class="historyUp">↑ ${h.upMbps} Mbps</span>
          ${h.pingMs ? `<span class="historyPing">⚡ ${h.pingMs}ms</span>` : ''}
        </div>
      </div>
      <div class="historyMeta">
        <span class="historyTime">${fmtTime(h.when)}</span>
        ${h.quality ? `<span class="historyBadge badge-${h.quality}">${h.quality}</span>` : ''}
      </div>
    </div>
  `).join('')
}

// ── Event listeners ───────────────────────────────────────────────────────────
toggle.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type:'SET_ENABLED', enabled: toggle.checked })
  await refresh()
})

autoBtn.addEventListener('click', async () => {
  const r    = await chrome.runtime.sendMessage({ type:'GET_STATE' })
  const next = !(r?.ok && r.autoTest)
  await chrome.runtime.sendMessage({ type:'SET_AUTO_TEST', autoTest: next })
  liveDown = null; liveUp = null
  await refresh()
})

speedTestBtn.addEventListener('click', async () => {
  liveDown = null; liveUp = null
  speedTestBtn.disabled = true
  status.textContent = 'Running test…'
  const r = await chrome.runtime.sendMessage({ type:'RUN_SPEED_TEST' })
  if (!r?.ok) status.textContent = r?.error || 'Test failed'
  speedTestBtn.disabled = false
  liveDown = null; liveUp = null
  await refresh()
  if (activeTab === 'history') renderHistory(lastState?.testHistory || [])
})

resetBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type:'RESET_TODAY' })
  await refresh()
})

refreshIpBtn?.addEventListener('click', () => loadIpInfo(true))

pingTestBtn?.addEventListener('click', async () => {
  pingTestBtn.disabled   = true
  pingStatus.textContent = 'Measuring ping…'
  pingBigVal.textContent = '…'
  const r = await chrome.runtime.sendMessage({ type:'MEASURE_PING' })
  pingTestBtn.disabled = false
  if (r?.ok && r.pingMs) {
    const ms = Math.round(r.pingMs)
    pingBigVal.textContent = ms
    pingStatus.textContent = `Latency to Cloudflare: ${ms}ms`
  } else {
    pingBigVal.textContent = '—'
    pingStatus.textContent = 'Ping failed'
  }
})

clearHistoryBtn?.addEventListener('click', async () => {
  await chrome.storage.local.set({ testHistory: [] })
  if (lastState) lastState.testHistory = []
  renderHistory([])
})

// ── Polling ───────────────────────────────────────────────────────────────────
refresh()
const t = setInterval(refresh, 1000)
window.addEventListener('unload', () => {
  clearInterval(t)
  if (liveTimer) clearTimeout(liveTimer)
})
