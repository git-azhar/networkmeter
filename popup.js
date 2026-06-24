function fmtBps(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return "0 b/s"
  const units = ["b/s", "Kb/s", "Mb/s", "Gb/s"]
  let v = bps * 8
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  const d = v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(d)} ${units[i]}`
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const d = v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(d)} ${units[i]}`
}

function orderedRing(arr, idx) {
  const out = []
  for (let i = 0; i < arr.length; i++) out.push(arr[(idx + i) % arr.length])
  return out
}

function drawChart(canvas, down, up) {
  const ctx = canvas.getContext("2d")
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const maxV = Math.max(1, ...down, ...up)
  const pad = 10
  const innerW = w - pad * 2
  const innerH = h - pad * 2

  ctx.globalAlpha = 0.18
  ctx.beginPath()
  for (let i = 0; i <= 4; i++) {
    const y = pad + (innerH * i) / 4
    ctx.moveTo(pad, y)
    ctx.lineTo(pad + innerW, y)
  }
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = 1

  function plot(series, stroke) {
    ctx.beginPath()
    for (let i = 0; i < series.length; i++) {
      const x = pad + (innerW * i) / (series.length - 1)
      const y = pad + innerH - (innerH * series[i]) / maxV
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2
    ctx.stroke()
  }

  plot(down, "rgba(120,170,255,0.95)")
  plot(up, "rgba(125,255,204,0.9)")
}

async function send(msg) {
  return await chrome.runtime.sendMessage(msg)
}

const toggle = document.getElementById("toggle")
const autoBtn = document.getElementById("autoBtn")
const autoState = document.getElementById("autoState")
const downEl = document.getElementById("down")
const upEl = document.getElementById("up")
const sub = document.getElementById("sub")
const badgeHint = document.getElementById("badgeHint")
const speedTestBtn = document.getElementById("speedTestBtn")
const resetBtn = document.getElementById("resetBtn")
const todayDown = document.getElementById("todayDown")
const todayUp = document.getElementById("todayUp")
const canvas = document.getElementById("chart")
const status = document.getElementById("status")
const verEl = document.getElementById("ver")
const openOptions = document.getElementById("openOptions")


if (verEl) {
  try { verEl.textContent = `v${chrome.runtime.getManifest().version}` } catch {}
}

if (openOptions) {
  openOptions.addEventListener("click", (e) => {
    e.preventDefault()
    chrome.runtime.openOptionsPage()
  })
}

let t = null
let liveDown = null
let liveUp = null
let liveTimer = null

function setLive(downBps, upBps) {
  if (Number.isFinite(downBps)) liveDown = downBps
  if (Number.isFinite(upBps)) liveUp = upBps
  if (liveTimer) return
  liveTimer = setTimeout(() => {
    if (Number.isFinite(liveDown)) downEl.textContent = fmtBps(liveDown)
    if (Number.isFinite(liveUp)) upEl.textContent = fmtBps(liveUp)
    liveTimer = null
  }, 100)
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object") return
  if (msg.type === "SPEED_PROGRESS") {
    if (Number.isFinite(msg.downBps)) setLive(msg.downBps, null)
    if (Number.isFinite(msg.upBps)) setLive(null, msg.upBps)
    status.textContent = "Manual test running..."
  }
  if (msg.type === "AUTO_PROGRESS") {
    if (Number.isFinite(msg.downBps)) setLive(msg.downBps, null)
    if (Number.isFinite(msg.upBps)) setLive(null, msg.upBps)
  }
})

async function refresh() {
  const r = await send({ type: "GET_STATE" })
  if (!r || r.ok !== true) {
    status.textContent = r && r.error ? r.error : "Service worker not responding"
    return
  }

  toggle.checked = !!r.enabled

  if (!Number.isFinite(liveDown)) downEl.textContent = fmtBps(r.lastDownBps)
  if (!Number.isFinite(liveUp)) upEl.textContent = fmtBps(r.lastUpBps)

  todayDown.textContent = fmtBytes(r.todayDown)
  todayUp.textContent = fmtBytes(r.todayUp)

  const down = orderedRing(r.ringDownBps || Array(60).fill(0), r.ringIdx || 0)
  const up = orderedRing(r.ringUpBps || Array(60).fill(0), r.ringIdx || 0)
  drawChart(canvas, down, up)

  autoState.textContent = r.autoTest ? "ON" : "OFF"
  autoBtn.textContent = r.autoTest ? "Stop Auto" : "Start Auto"

  const mbps = (r.lastDownBps * 8) / 1_000_000
  badgeHint.textContent = r.autoTest ? `Badge: ${mbps >= 0 ? mbps.toFixed(mbps >= 10 ? 1 : 2) : "—"} Mbps` : "Badge: off"

  if (r.speedTest && r.speedTest.running) status.textContent = "Manual test running..."
  else if (r.speedTest && r.speedTest.error) status.textContent = `Manual test error: ${r.speedTest.error}`
  else if (r.speedTest && typeof r.speedTest.lastDownMbps === "number" && typeof r.speedTest.lastUpMbps === "number") status.textContent = `Manual last: ↓ ${r.speedTest.lastDownMbps.toFixed(2)} Mbps  ↑ ${r.speedTest.lastUpMbps.toFixed(2)} Mbps`
  else if (!status.textContent || status.textContent === "Manual test running...") status.textContent = ""

  sub.textContent = r.autoTest ? "Auto monitoring active" : "Auto monitoring off"
}

toggle.addEventListener("change", async () => {
  await send({ type: "SET_ENABLED", enabled: toggle.checked })
  await refresh()
})

autoBtn.addEventListener("click", async () => {
  const r = await send({ type: "GET_STATE" })
  const next = !(r && r.ok === true && r.autoTest)
  await send({ type: "SET_AUTO_TEST", autoTest: next })
  liveDown = null
  liveUp = null
  await refresh()
})

speedTestBtn.addEventListener("click", async () => {
  liveDown = null
  liveUp = null
  speedTestBtn.disabled = true
  const r = await send({ type: "RUN_SPEED_TEST" })
  if (!r || r.ok !== true) status.textContent = r && r.error ? r.error : "Manual test failed"
  speedTestBtn.disabled = false
  liveDown = null
  liveUp = null
  await refresh()
})

resetBtn.addEventListener("click", async () => {
  await send({ type: "RESET_TODAY" })
  await refresh()
})

refresh()
t = setInterval(refresh, 1000)
window.addEventListener("unload", () => {
  if (t) clearInterval(t)
  if (liveTimer) clearTimeout(liveTimer)
})
