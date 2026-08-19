/**
 * Browser verification for the image-inbox paste bridge, against a TEMP
 * DSH instance (never the user's profile).
 *
 * Usage: node scripts/verify-image-inbox.mjs [--send]
 *   --send   after the paste assertion, actually submit and wait for the
 *            main agent to route the image (real API calls, slower).
 *
 * Browser: the system Edge (channel: msedge) on Windows; the bundled
 * chromium channel everywhere else (the Docker e2e image installs it).
 * Override with DSH_E2E_CHANNEL (e.g. 'chromium', 'msedge', 'chrome').
 * Screenshots land in $DSH_E2E_DIR/shots (default %TEMP%\dsh-inbox-e2e).
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.DSH_E2E_URL ?? 'http://127.0.0.1:3081'
const ENV_DIR = process.env.DSH_E2E_DIR ?? join(process.env.TEMP ?? '/tmp', 'dsh-inbox-e2e')
const SHOTS = join(ENV_DIR, 'shots')
const WORKSPACE = join(ENV_DIR, 'workspace')
const SEND = process.argv.includes('--send')
mkdirSync(SHOTS, { recursive: true })
mkdirSync(WORKSPACE, { recursive: true })

let failures = 0
const assert = (cond, label) => {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.error(`  FAIL: ${label}`)
  }
}

const browser = await chromium.launch({
  channel: process.env.DSH_E2E_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'),
  headless: true,
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const page = await context.newPage()

const consoleMessages = []
const pageErrors = []
const failedRequests = []
page.on('console', (msg) => {
  consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
  if (msg.type() === 'error' || msg.type() === 'warning') console.log(`  console> ${msg.text().slice(0, 240)}`)
})
page.on('pageerror', (err) => {
  pageErrors.push(String(err))
  console.log(`  pageerror> ${String(err).slice(0, 240)}`)
})
page.on('requestfailed', (req) => failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`))
page.on('response', (res) => {
  if (res.status() >= 400) failedRequests.push(`${res.request().method()} ${res.url()} -> ${res.status()}`)
})

const shot = async (name) => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false })
}

/** Dump interactive elements to ease selector probing. */
const dumpUI = async (label) => {
  const info = await page.evaluate(() => {
    const text = (el) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
    return {
      buttons: [...document.querySelectorAll('button')].map((el) => text(el)).filter(Boolean).slice(0, 30),
      inputs: [...document.querySelectorAll('input')].map((el) => ({ ph: el.placeholder, value: el.value, type: el.type })).filter((i) => i.ph || i.value || i.type === 'text').slice(0, 20),
      textareas: document.querySelectorAll('textarea').length,
      body: text(document.body).slice(0, 300),
    }
  })
  console.log(`-- ${label} --`)
  console.log(`   buttons: ${info.buttons.join(' | ')}`)
  console.log(`   inputs: ${JSON.stringify(info.inputs)}`)
  console.log(`   textareas: ${info.textareas}`)
  console.log(`   body: ${info.body}`)
}

try {
  console.log(`== opening ${BASE} ==`)
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(4000)
  await shot('01-loaded')
  await dumpUI('after load')

  // ── boot cleanliness ──────────────────────────────────────────────
  const bootFailures = consoleMessages.filter((m) => /did not activate|pending \(waiting|web boot: [^0]|client-modules/.test(m))
  assert(bootFailures.length === 0, `web boot clean (${bootFailures.length} boot errors)`)
  assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`)

  // ── dismiss any onboarding/welcome/API-key overlay ──────────────────
  // Fresh instances may show a first-run API-key modal ("稍后配置" /
  // "Save and continue") that keeps the composer inert — dismiss it, and
  // repeat after opening a session, since some modals only appear then.
  const dismissOverlays = async () => {
    const dismissButtons = page.locator('button', { hasText: /继续|知道了|关闭|好的|稍后配置|跳过|Got it|Continue|Close|Skip/ })
    for (let i = 0; i < (await dismissButtons.count()); i++) {
      const btn = dismissButtons.nth(i)
      if (await btn.isVisible().catch(() => false)) {
        try {
          await btn.click({ timeout: 3000 })
          console.log(`  dismissed overlay via button: ${(await btn.textContent())?.trim()}`)
          break
        } catch {
          /* try the next candidate */
        }
      }
    }
    await page.waitForTimeout(800)
  }
  await dismissOverlays()

  // ── create a workspace through the same API the app uses (the native
  //    directory picker cannot be driven headlessly) ───────────────────
  const createWs = await page.evaluate(async (path) => {
    const response = await fetch('/api/workspace.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `verify-${Date.now()}`,
        method: 'workspace.create',
        payload: { path },
      }),
    })
    return { status: response.status, body: await response.text() }
  }, WORKSPACE)
  console.log(`workspace.create -> ${createWs.status}: ${createWs.body.slice(0, 240)}`)
  assert(createWs.status === 200 && /"ok":true/.test(createWs.body), 'workspace created via API')
  await page.waitForTimeout(1200)

  // ── open a session: click 新会话 ────────────────────────────────────
  const newSession = page.locator('button', { hasText: /^新会话$/ }).first()
  if ((await newSession.count()) > 0) {
    await newSession.click({ force: true })
    await page.waitForTimeout(2500)
    await dismissOverlays()
    await shot('02-new-session')
  }
  await dumpUI('after new session')

  // ── find the composer textarea ────────────────────────────────────
  const ta = page.locator('textarea').first()
  await ta.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
  const hasComposer = (await ta.count()) > 0
  assert(hasComposer, 'composer textarea present after session open')
  if (hasComposer) {
    // give the bridge time to mount + refresh capability
    await page.waitForTimeout(1500)
    await ta.click()
    // ── synthetic image paste ───────────────────────────────────────
    await page.evaluate(() => {
      const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
      const file = new File([bytes], 'probe.png', { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      const target = document.querySelector('textarea')
      target.focus()
      target.dispatchEvent(ev)
    })
    await page.waitForTimeout(3000)
    const draft = await ta.inputValue()
    console.log(`draft after paste: ${JSON.stringify(draft)}`)
    assert(draft.includes('[图片: .dsh-inbox/'), `paste intercepted: draft contains the workspace path (${draft.trim()})`)
    // Regression: pasting must NOT start a turn. The old injected host
    // message appeared as a user bubble and woke the agent immediately.
    const afterPaste = await page.evaluate(() => (document.body.textContent ?? '').replace(/\s+/g, ' '))
    assert(!afterPaste.includes('用户粘贴了一张图片'), 'paste does not inject a message or wake the agent')
    await shot('04-after-paste')

    const draftPath = (draft.match(/\[图片: ([^\]]+)\]/) ?? [])[1]
    const foundInbox = []
    const walk = (dir, depth) => {
      if (depth > 6) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        if (entry.isDirectory()) {
          if (entry.name === '.dsh-inbox') foundInbox.push(...readdirSync(full).map((f) => join(full, f)))
          else walk(full, depth + 1)
        }
      }
    }
    walk(ENV_DIR, 0)
    assert(
      draftPath !== undefined && foundInbox.some((f) => f.endsWith(draftPath.split('/').pop() ?? '')),
      `the drafted path exists in a workspace .dsh-inbox/ (${draftPath})`,
    )

    if (SEND) {
      await ta.press('Enter')
      console.log('sent; waiting for the main agent to route the image…')
      for (const pause of [60000, 60000, 90000, 90000]) {
        await page.waitForTimeout(pause)
        const probe = await page.evaluate(() => (document.body.textContent ?? '').replace(/\s+/g, ' '))
        const markers = {
          subagent: probe.includes('子代理'),
          looker: /观察员|looker|vision|team_call/.test(probe),
          imageText: /The user pasted|用户粘贴|图片/.test(probe),
          finished: /已完成|刚刚|Today/.test(probe),
        }
        console.log('progress:', JSON.stringify(markers))
        await shot(`05-send-${pause / 1000}s`)
        if (markers.finished) break
      }
      const bodyText = await page.evaluate(() => (document.body.textContent ?? ''))
      console.log('body after send:', bodyText.replace(/\s+/g, ' ').slice(0, 900))
    }
  }

  // ── network failures (non-2xx) ────────────────────────────────────
  const realFailures = failedRequests.filter((line) => !/fonts|favicon|\.map/.test(line))
  if (realFailures.length > 0) console.log('failed requests:\n  ' + realFailures.join('\n  '))
  assert(!SEND || realFailures.length === 0, `no failed network requests (${realFailures.length})`)

  writeFileSync(join(SHOTS, 'console.log'), consoleMessages.join('\n'), 'utf8')
} catch (error) {
  console.error('verification crashed:', error)
  await shot('99-crash').catch(() => {})
  failures++
} finally {
  await browser.close()
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll browser assertions passed.')
