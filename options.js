function clampInt(v, min, max, defv) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : defv
}

// ── Theme ─────────────────────────────────────────────────────────────────────
async function applyTheme() {
  const r = await chrome.storage.local.get('theme')
  const isLight = r.theme === 'light'
  document.body.classList.toggle('light', isLight)
  document.getElementById('themeDark').classList.toggle('active', !isLight)
  document.getElementById('themeLight').classList.toggle('active', isLight)
}

document.getElementById('themeDark').addEventListener('click', async () => {
  await chrome.storage.local.set({ theme: 'dark' })
  applyTheme()
})
document.getElementById('themeLight').addEventListener('click', async () => {
  await chrome.storage.local.set({ theme: 'light' })
  applyTheme()
})

applyTheme()

// ── Version ───────────────────────────────────────────────────────────────────
try { document.getElementById('devVer').textContent = `v${chrome.runtime.getManifest().version}` } catch {}

// ── Load ──────────────────────────────────────────────────────────────────────
async function load() {
  const r = await chrome.storage.local.get([
    'testSeconds','autoIntervalSec','autoSeconds','cfDownBytes','cfUpBytes','alerts'
  ])

  document.getElementById('testSeconds').value    = typeof r.testSeconds    === 'number' ? r.testSeconds    : 10
  document.getElementById('autoIntervalSec').value= typeof r.autoIntervalSec=== 'number' ? r.autoIntervalSec: 10
  document.getElementById('autoSeconds').value    = typeof r.autoSeconds    === 'number' ? r.autoSeconds    : 3
  document.getElementById('cfDownBytes').value    = typeof r.cfDownBytes    === 'number' ? r.cfDownBytes    : 5000000
  document.getElementById('cfUpBytes').value      = typeof r.cfUpBytes      === 'number' ? r.cfUpBytes      : 2000000

  if (r.alerts && typeof r.alerts === 'object') {
    document.getElementById('alertEnabled').checked   = !!r.alerts.enabled
    document.getElementById('alertThreshold').value   = r.alerts.thresholdMbps || 10
    document.getElementById('alertCooldown').value    = r.alerts.cooldownMin   || 5
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function save() {
  const testSeconds     = clampInt(document.getElementById('testSeconds').value     || 10, 3,  30, 10)
  const autoIntervalSec = clampInt(document.getElementById('autoIntervalSec').value || 10, 3,  60, 10)
  const autoSeconds     = clampInt(document.getElementById('autoSeconds').value     || 3,  2,  10,  3)
  const cfDownBytes     = clampInt(document.getElementById('cfDownBytes').value     || 5000000, 250000,  20000000, 5000000)
  const cfUpBytes       = clampInt(document.getElementById('cfUpBytes').value       || 2000000, 100000,  10000000, 2000000)
  const alertEnabled    = document.getElementById('alertEnabled').checked
  const alertThreshold  = clampInt(document.getElementById('alertThreshold').value  || 10, 1, 1000, 10)
  const alertCooldown   = clampInt(document.getElementById('alertCooldown').value   || 5,  1,   60,  5)

  await chrome.storage.local.set({
    testSeconds, autoIntervalSec, autoSeconds, cfDownBytes, cfUpBytes,
    alerts: { enabled: alertEnabled, thresholdMbps: alertThreshold, cooldownMin: alertCooldown }
  })

  // Sync alerts to service worker
  chrome.runtime.sendMessage({
    type: 'SET_ALERTS',
    alerts: { enabled: alertEnabled, thresholdMbps: alertThreshold, cooldownMin: alertCooldown }
  }).catch(() => {})

  const status = document.getElementById('status')
  status.textContent = '✓ Saved'
  setTimeout(() => status.textContent = '', 1500)
}

document.getElementById('save').addEventListener('click', save)
load()
