let timer = null
let running = false

async function getAutoCfg() {
  const r = await chrome.runtime.sendMessage({ type: "GET_AUTO_CFG" })
  if (!r || r.ok !== true) return { autoIntervalSec: 10 }
  return { autoIntervalSec: r.autoIntervalSec }
}

async function tick() {
  if (running) return
  running = true
  try {
    const s = await chrome.runtime.sendMessage({ type: "GET_STATE" })
    if (s && s.ok === true && s.autoTest) {
      await chrome.runtime.sendMessage({ type: "AUTO_SAMPLE" })
    }
  } catch (e) {
  }
  running = false
  schedule()
}

async function schedule() {
  if (timer) clearTimeout(timer)
  const cfg = await getAutoCfg()
  timer = setTimeout(tick, cfg.autoIntervalSec * 1000)
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object") return
  if (msg.type === "AUTO_WAKE") {
    if (timer) clearTimeout(timer)
    timer = setTimeout(tick, 0)
  }
})

schedule()
