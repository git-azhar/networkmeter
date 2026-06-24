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
  return n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n)
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts), now = new Date()
  const time = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
  return d.toDateString()===now.toDateString() ? time : `${d.toLocaleDateString([],{month:'short',day:'numeric'})} ${time}`
}

function fmtUptime(startTs) {
  if (!startTs) return '—'
  let s = Math.floor((Date.now() - startTs) / 1000)
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
}

function orderedRing(arr, idx) {
  return arr.map((_, i) => arr[(idx+i) % arr.length])
}

// ── Charts ────────────────────────────────────────────────────────────────────
function drawSpeedChart(canvas, down, up, ping) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  const pad=8, iW=W-pad*2, iH=H-pad*2
  const maxSpeed = Math.max(1,...down,...up)
  const maxPing  = Math.max(1,...ping)

  ctx.globalAlpha=0.1; ctx.strokeStyle='#ffffff'; ctx.lineWidth=1
  ctx.beginPath()
  for (let i=0;i<=4;i++) { const y=pad+(iH*i)/4; ctx.moveTo(pad,y); ctx.lineTo(pad+iW,y) }
  ctx.stroke(); ctx.globalAlpha=1

  // Filled area under download
  ctx.beginPath(); ctx.globalAlpha=0.07
  down.forEach((v,i) => {
    const x=pad+(iW*i)/(down.length-1), y=pad+iH-(iH*v)/maxSpeed
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
  })
  ctx.lineTo(pad+iW,pad+iH); ctx.lineTo(pad,pad+iH); ctx.closePath()
  ctx.fillStyle='#2b78ff'; ctx.fill(); ctx.globalAlpha=1

  const line = (series,maxV,color,alpha=0.9) => {
    if (series.every(v=>v===0)) return
    ctx.beginPath(); ctx.globalAlpha=alpha
    series.forEach((v,i)=>{
      const x=pad+(iW*i)/(series.length-1), y=pad+iH-(iH*v)/maxV
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    })
    ctx.strokeStyle=color; ctx.lineWidth=1.8; ctx.stroke(); ctx.globalAlpha=1
  }
  line(down, maxSpeed, 'rgba(91,159,255,0.95)')
  line(up,   maxSpeed, 'rgba(78,207,160,0.9)')
  line(ping, maxPing,  'rgba(255,210,80,0.8)', 0.7)
}

function drawWeekChart(canvas, weeklyStats) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const days = []
  const today = new Date()
  for (let i=6;i>=0;i--) {
    const d = new Date(today); d.setDate(d.getDate()-i)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    days.push({ key, label: d.toLocaleDateString([],{weekday:'short'}), data: weeklyStats[key]||null })
  }

  const maxDown = Math.max(1, ...days.map(d => d.data?.downMbps||0))
  const maxPing = Math.max(1, ...days.map(d => d.data?.pingMs||0))
  const pad=8, barPad=4
  const barW = (W - pad*2 - barPad*(days.length-1)) / days.length
  const iH = H - pad*2 - 18

  // Grid
  ctx.globalAlpha=0.08; ctx.strokeStyle='#ffffff'; ctx.lineWidth=1
  ctx.beginPath()
  for(let i=0;i<=3;i++){const y=pad+(iH*i)/3;ctx.moveTo(pad,y);ctx.lineTo(W-pad,y)}
  ctx.stroke(); ctx.globalAlpha=1

  days.forEach((day, i) => {
    const x = pad + i * (barW + barPad)

    if (day.data?.downMbps) {
      const bh = (day.data.downMbps / maxDown) * iH
      const by = pad + iH - bh
      ctx.fillStyle = 'rgba(91,159,255,0.7)'
      ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(x, by, barW, bh, 3) : ctx.rect(x, by, barW, bh)
      ctx.fill()
    }

    if (day.data?.pingMs) {
      const py = pad + iH - (day.data.pingMs / maxPing) * iH
      ctx.fillStyle = 'rgba(255,210,80,0.9)'
      ctx.beginPath(); ctx.arc(x + barW/2, py, 3, 0, Math.PI*2); ctx.fill()
    }

    // Day label
    ctx.fillStyle = 'rgba(238,243,255,0.45)'
    ctx.font = '9px ui-sans-serif,system-ui,sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(day.label, x + barW/2, H - 2)
  })
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)

// Speed tab
const toggle       = $('toggle')
const autoBtn      = $('autoBtn')
const autoState    = $('autoState') // not in new HTML, kept for compat
const downEl       = $('down')
const upEl         = $('up')
const sub          = $('sub')
const badgeHint    = $('badgeHint')
const pingVal      = $('pingVal')
const jitterVal    = $('jitterVal')
const qualityVal   = $('qualityVal')
const peakDown     = $('peakDown')
const peakUp       = $('peakUp')
const uptimeVal    = $('uptimeVal')
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
const copyIpBtn    = $('copyIpBtn')
const refreshIpBtn = $('refreshIpBtn')
const ipInfoArea   = $('ipInfoArea')
const pingBigVal   = $('pingBigVal')
const jitterBigVal = $('jitterBigVal')
const pingTestBtn  = $('pingTestBtn')
const pingStatus   = $('pingStatus')
const ispHistoryList = $('ispHistoryList')

// Stats tab
const weekChart    = $('weekChart')
const weeklyTable  = $('weeklyTable')
const exportBtn    = $('exportBtn')
const alertToggle  = $('alertToggle')
const alertThresh  = $('alertThresh')
const alertStatus  = $('alertStatus')

// History tab
const historyList     = $('historyList')
const clearHistoryBtn = $('clearHistoryBtn')

// ── Theme ─────────────────────────────────────────────────────────────────────
async function applyTheme() {
  const r = await chrome.storage.local.get('theme')
  document.body.classList.toggle('light', r.theme === 'light')
}
applyTheme()

// ── Version ───────────────────────────────────────────────────────────────────
try { verEl.textContent = `v${chrome.runtime.getManifest().version}` } catch {}
openOptions?.addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage() })

// ── Tabs ──────────────────────────────────────────────────────────────────────
let activeTab = 'speed'
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b===btn))
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id!==`tab-${activeTab}`))
    if (activeTab==='network') { loadIpInfo(); loadIspHistory() }
    if (activeTab==='stats')   loadStats()
    if (activeTab==='history') renderHistory(lastState?.testHistory||[])
  })
})

// ── Live speed ────────────────────────────────────────────────────────────────
let liveDown=null, liveUp=null, liveTimer=null
function setLive(d,u) {
  if (Number.isFinite(d)) liveDown=d
  if (Number.isFinite(u)) liveUp=u
  if (liveTimer) return
  liveTimer = setTimeout(() => {
    if (Number.isFinite(liveDown)) downEl.textContent = fmtBps(liveDown)
    if (Number.isFinite(liveUp))   upEl.textContent   = fmtBps(liveUp)
    liveTimer = null
  }, 100)
}

chrome.runtime.onMessage.addListener(msg => {
  if (!msg?.type) return
  if (msg.type==='SPEED_PROGRESS') { if(Number.isFinite(msg.downBps))setLive(msg.downBps,null); if(Number.isFinite(msg.upBps))setLive(null,msg.upBps); status.textContent='Test running…' }
  if (msg.type==='AUTO_PROGRESS')  { if(Number.isFinite(msg.downBps))setLive(msg.downBps,null); if(Number.isFinite(msg.upBps))setLive(null,msg.upBps) }
})

// ── Quality helper ────────────────────────────────────────────────────────────
function getQuality(pingMs, downMbps) {
  if (!pingMs||pingMs<=0) return null
  if (pingMs<20 && downMbps>=50) return 'Excellent'
  if (pingMs<50 && downMbps>=10) return 'Good'
  if (pingMs<100&& downMbps>=2)  return 'Fair'
  return 'Poor'
}

// ── Main refresh ──────────────────────────────────────────────────────────────
let lastState = null

async function refresh() {
  const r = await chrome.runtime.sendMessage({ type:'GET_STATE' })
  if (!r?.ok) { status.textContent = r?.error||'Service worker not responding'; return }
  lastState = r

  toggle.checked = !!r.enabled

  // Speed
  if (!Number.isFinite(liveDown)) downEl.textContent = fmtBps(r.lastDownBps)
  if (!Number.isFinite(liveUp))   upEl.textContent   = fmtBps(r.lastUpBps)

  // Peak
  peakDown.textContent = fmtBps(r.peakDownBps||0)
  peakUp.textContent   = fmtBps(r.peakUpBps||0)

  // Uptime
  uptimeVal.textContent = fmtUptime(r.uptimeStart)

  // Ping + jitter
  if (r.lastPingMs)   pingVal.textContent   = `${Math.round(r.lastPingMs)}ms`
  if (r.lastJitterMs) jitterVal.textContent = `${Math.round(r.lastJitterMs)}ms`

  // Quality
  const downMbps = (r.lastDownBps*8)/1_000_000
  const quality  = getQuality(r.lastPingMs, downMbps)
  qualityVal.textContent = quality || '—'
  qualityVal.className   = `pingNum quality-${quality||''}`

  // Auto
  autoBtn.textContent = r.autoTest ? 'Stop Auto' : 'Start Auto'
  autoBtn.classList.toggle('active-pill', !!r.autoTest)
  sub.textContent = r.autoTest ? 'Auto monitoring active' : 'Monitoring off'

  // Badge hint
  const mbps = (r.lastDownBps*8)/1_000_000
  badgeHint.textContent = r.autoTest ? `Badge: ${mbps.toFixed(mbps>=10?1:2)} Mbps` : 'Badge: off'

  // Usage
  todayDown.textContent = fmtBytes(r.todayDown)
  todayUp.textContent   = fmtBytes(r.todayUp)
  todayReqs.textContent = fmtNum(r.todayRequests||0)

  // Chart
  drawSpeedChart(canvas,
    orderedRing(r.ringDownBps||Array(60).fill(0), r.ringIdx||0),
    orderedRing(r.ringUpBps  ||Array(60).fill(0), r.ringIdx||0),
    orderedRing(r.ringPingMs ||Array(60).fill(0), r.ringIdx||0)
  )

  // Status
  if (r.speedTest?.running) status.textContent = 'Test running…'
  else if (r.speedTest?.error) status.textContent = `Error: ${r.speedTest.error}`
  else if (r.speedTest?.lastDownMbps!=null) {
    const p = r.speedTest.lastPingMs ? ` · ${Math.round(r.speedTest.lastPingMs)}ms` : ''
    const j = r.speedTest.lastJitterMs ? ` ±${Math.round(r.speedTest.lastJitterMs)}ms` : ''
    status.textContent = `Last: ↓${r.speedTest.lastDownMbps.toFixed(1)} ↑${r.speedTest.lastUpMbps.toFixed(1)} Mbps${p}${j}`
  } else if (!status.textContent||status.textContent==='Test running…') status.textContent=''

  // Alerts UI
  if (r.alerts) {
    alertToggle.checked    = !!r.alerts.enabled
    alertThresh.value      = r.alerts.thresholdMbps||10
  }

  // Network tab live updates
  if (activeTab==='network') {
    if (r.lastPingMs)   pingBigVal.textContent   = Math.round(r.lastPingMs)
    if (r.lastJitterMs) jitterBigVal.textContent = Math.round(r.lastJitterMs)
  }

  // History tab live
  if (activeTab==='history') renderHistory(r.testHistory||[])
}

// ── IP Info ───────────────────────────────────────────────────────────────────
let currentIp = null

async function loadIpInfo(force=false) {
  ipInfoArea.innerHTML = '<div class="ipLoading">Fetching…</div>'
  const r = await chrome.runtime.sendMessage({ type:'GET_IP_INFO', force })
  currentIp = r?.ipInfo?.ip || null
  renderIpInfo(r?.ipInfo)
}

function renderIpInfo(info) {
  if (!info||info.fetching) { ipInfoArea.innerHTML='<div class="ipLoading">Fetching…</div>'; return }
  if (info.error&&!info.ip) { ipInfoArea.innerHTML=`<div class="ipError">${info.error}</div>`; return }
  const flag = info.flag ? `<img class="flagImg" src="${info.flag}" alt="">` : ''
  const rows = [
    { k:'IP Address', v:`<span class="ipValBlue">${info.ip||'—'}</span>` },
    { k:'ISP / Org',  v: info.isp||'—' },
    { k:'City',       v: info.city||'—' },
    { k:'Region',     v: info.region||'—' },
    { k:'Country',    v: `${flag}${info.country||'—'}` },
    { k:'Timezone',   v: info.timezone||'—' },
    { k:'Source',     v: `<span style="color:rgba(238,243,255,0.35);font-size:10px">${info.provider||'—'}</span>` },
  ]
  ipInfoArea.innerHTML = rows.map(row=>`
    <div class="ipRow"><span class="ipKey">${row.k}</span><span class="ipVal">${row.v}</span></div>
  `).join('')
}

function loadIspHistory() {
  chrome.runtime.sendMessage({ type:'GET_ISP_HISTORY' }).then(r => {
    if (!r?.ispHistory?.length) {
      ispHistoryList.innerHTML = '<div class="historyEmpty">No ISP changes detected.</div>'
      return
    }
    ispHistoryList.innerHTML = r.ispHistory.map(h => `
      <div class="ispItem">
        <div class="ispItemTop">
          <span>${h.ip}</span>
          <span style="color:rgba(238,243,255,0.45);font-size:10px">${fmtTime(h.detectedAt)}</span>
        </div>
        <div class="ispItemSub">${h.isp||'Unknown ISP'}${h.country?` · ${h.country}`:''}</div>
        <div class="ispItemSub">← was ${h.prevIp} (${h.prevIsp})</div>
      </div>
    `).join('')
  })
}

// ── Stats tab ─────────────────────────────────────────────────────────────────
async function loadStats() {
  const r = await chrome.runtime.sendMessage({ type:'GET_WEEKLY_STATS' })
  const stats = r?.weeklyStats || {}
  drawWeekChart(weekChart, stats)
  renderWeeklyTable(stats)
}

function renderWeeklyTable(stats) {
  const today = new Date()
  const rows = []
  for (let i=6;i>=0;i--) {
    const d = new Date(today); d.setDate(d.getDate()-i)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const s   = stats[key]
    const label = i===0?'Today':i===1?'Yesterday':d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})
    rows.push(`
      <div class="weeklyRow">
        <span class="weeklyK">${label}</span>
        <div class="weeklyVals">
          <span class="weeklyDown">${s?s.downMbps.toFixed(1)+' Mbps':'—'}</span>
          <span class="weeklyPing">${s&&s.pingMs?Math.round(s.pingMs)+'ms':'—'}</span>
          <span style="font-size:10px;color:rgba(238,243,255,0.35)">${s?s.samples+'×':''}</span>
        </div>
      </div>
    `)
  }
  weeklyTable.innerHTML = rows.join('')
}

// ── History ───────────────────────────────────────────────────────────────────
function renderHistory(history) {
  if (!history?.length) {
    historyList.innerHTML = '<div class="historyEmpty">No tests yet. Run a speed test to start.</div>'
    return
  }
  historyList.innerHTML = history.map(h => `
    <div class="historyItem">
      <div>
        <div class="historyMain">
          <span class="historyDown">↓ ${h.downMbps}</span>
          <span class="historyUp">↑ ${h.upMbps} Mbps</span>
          ${h.pingMs   ? `<span class="historyPing">⚡ ${h.pingMs}ms</span>` : ''}
          ${h.jitterMs ? `<span class="historyJitter">±${h.jitterMs}ms</span>` : ''}
        </div>
      </div>
      <div class="historyMeta">
        <span class="historyTime">${fmtTime(h.when)}</span>
        ${h.quality?`<span class="historyBadge badge-${h.quality}">${h.quality}</span>`:''}
      </div>
    </div>
  `).join('')
}

// ── Event listeners ───────────────────────────────────────────────────────────
toggle.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type:'SET_ENABLED', enabled:toggle.checked })
  await refresh()
})

autoBtn.addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type:'GET_STATE' })
  await chrome.runtime.sendMessage({ type:'SET_AUTO_TEST', autoTest:!(r?.ok&&r.autoTest) })
  liveDown=null; liveUp=null
  await refresh()
})

speedTestBtn.addEventListener('click', async () => {
  liveDown=null; liveUp=null; speedTestBtn.disabled=true
  status.textContent='Running test…'
  const r = await chrome.runtime.sendMessage({ type:'RUN_SPEED_TEST' })
  if (!r?.ok) status.textContent = r?.error||'Test failed'
  speedTestBtn.disabled=false; liveDown=null; liveUp=null
  await refresh()
  if (activeTab==='history') renderHistory(lastState?.testHistory||[])
})

resetBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type:'RESET_TODAY' }); await refresh()
})

// Copy IP
copyIpBtn?.addEventListener('click', async () => {
  const ip = currentIp || lastState?.ipInfo?.ip
  if (!ip) return
  try {
    await navigator.clipboard.writeText(ip)
    copyIpBtn.textContent = 'Copied!'
    copyIpBtn.classList.add('copied')
    setTimeout(() => { copyIpBtn.textContent='Copy'; copyIpBtn.classList.remove('copied') }, 1500)
  } catch {}
})

refreshIpBtn?.addEventListener('click', () => loadIpInfo(true))

pingTestBtn?.addEventListener('click', async () => {
  pingTestBtn.disabled=true; pingStatus.textContent='Measuring…'
  pingBigVal.textContent='…'; jitterBigVal.textContent='…'
  const r = await chrome.runtime.sendMessage({ type:'MEASURE_PING' })
  pingTestBtn.disabled=false
  if (r?.ok) {
    pingBigVal.textContent   = r.pingMs   ? Math.round(r.pingMs)   : '—'
    jitterBigVal.textContent = r.jitterMs ? Math.round(r.jitterMs) : '—'
    pingStatus.textContent = r.pingMs ? `Cloudflare: ${Math.round(r.pingMs)}ms ping, ±${Math.round(r.jitterMs||0)}ms jitter` : 'Ping failed'
  } else {
    pingBigVal.textContent='—'; pingStatus.textContent='Ping failed'
  }
})

// Alerts
alertToggle?.addEventListener('change', async () => {
  const thresh = parseFloat(alertThresh.value)||10
  await chrome.runtime.sendMessage({ type:'SET_ALERTS', alerts:{ enabled:alertToggle.checked, thresholdMbps:thresh } })
  alertStatus.textContent = alertToggle.checked ? `Alert on < ${thresh} Mbps` : 'Alerts off'
  setTimeout(()=>alertStatus.textContent='', 1500)
})

alertThresh?.addEventListener('change', async () => {
  const thresh = Math.max(1, parseFloat(alertThresh.value)||10)
  await chrome.runtime.sendMessage({ type:'SET_ALERTS', alerts:{ thresholdMbps:thresh } })
})

// Export CSV
exportBtn?.addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type:'EXPORT_CSV' })
  if (!r?.csv) return
  const blob = new Blob([r.csv], { type:'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `network-meter-${new Date().toISOString().slice(0,10)}.csv`
  a.click(); URL.revokeObjectURL(url)
})

clearHistoryBtn?.addEventListener('click', async () => {
  await chrome.storage.local.set({ testHistory:[] })
  if (lastState) lastState.testHistory=[]
  renderHistory([])
})

// ── Polling ───────────────────────────────────────────────────────────────────
refresh()
const t = setInterval(refresh, 1000)
window.addEventListener('unload', () => { clearInterval(t); if(liveTimer)clearTimeout(liveTimer) })
