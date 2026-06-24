function clampInt(v, min, max, defv) {
  const n = Number(v)
  if (!Number.isFinite(n)) return defv
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

async function load() {
  const r = await chrome.storage.local.get([
    "testSeconds",
    "autoIntervalSec",
    "autoSeconds",
    "cfDownBytes",
    "cfUpBytes"
  ])
  document.getElementById("testSeconds").value = typeof r.testSeconds === "number" ? r.testSeconds : 10
  document.getElementById("autoIntervalSec").value = typeof r.autoIntervalSec === "number" ? r.autoIntervalSec : 10
  document.getElementById("autoSeconds").value = typeof r.autoSeconds === "number" ? r.autoSeconds : 3
  document.getElementById("cfDownBytes").value = typeof r.cfDownBytes === "number" ? r.cfDownBytes : 5000000
  document.getElementById("cfUpBytes").value = typeof r.cfUpBytes === "number" ? r.cfUpBytes : 2000000
}

async function save() {
  const testSeconds = clampInt(document.getElementById("testSeconds").value || 10, 3, 30, 10)
  const autoIntervalSec = clampInt(document.getElementById("autoIntervalSec").value || 10, 3, 60, 10)
  const autoSeconds = clampInt(document.getElementById("autoSeconds").value || 3, 2, 10, 3)
  const cfDownBytes = clampInt(document.getElementById("cfDownBytes").value || 5000000, 250000, 20000000, 5000000)
  const cfUpBytes = clampInt(document.getElementById("cfUpBytes").value || 2000000, 100000, 10000000, 2000000)

  await chrome.storage.local.set({ testSeconds, autoIntervalSec, autoSeconds, cfDownBytes, cfUpBytes })
  const status = document.getElementById("status")
  status.textContent = "Saved"
  setTimeout(() => status.textContent = "", 1200)
}

document.getElementById("save").addEventListener("click", save)
load()
