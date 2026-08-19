/**
 * Screenshot + layout audit harness.
 *
 * Usage:
 *   node shot.mjs                          # 1440px, default view
 *   node shot.mjs 1200                     # one width
 *   node shot.mjs 1440,1200,900            # several
 *   node shot.mjs 1440 light               # force the light theme first
 *
 * Writes PNGs to ./shots/ and prints three things the screenshot itself cannot
 * show: console errors, horizontal document overflow, and any panel whose height
 * is mostly empty — the two failure modes this rebuild is being judged on.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const widths = (process.argv[2] ?? '1440').split(',').map(Number)
const theme = process.argv[3] ?? null
const URL = process.env.URL ?? 'http://localhost:5173'

mkdirSync('shots', { recursive: true })

const browser = await chromium.launch()
let failed = false

for (const width of widths) {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
  })

  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push(String(e)))
  // Playwright reports an *aborted* request as a failure too, and closing the
  // page cancels the <audio> element's in-flight preload every single run. That
  // is the browser doing the right thing, not the app breaking, so only genuine
  // failures count.
  page.on('requestfailed', (r) => {
    const aborted = r.failure()?.errorText?.includes('ERR_ABORTED')
    if (aborted && (r.resourceType() === 'media' || r.url().includes('/api/clips/'))) return
    errs.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'unknown'})`)
  })

  // Any runtime font request defeats the offline guarantee the whole type system
  // is built around, so it is an error here rather than a note.
  const remote = []
  page.on('request', (r) => {
    const u = r.url()
    if (!u.startsWith(URL) && !u.startsWith('data:') && !u.startsWith('blob:')) remote.push(u)
  })

  if (theme) {
    await page.addInitScript(
      (t) => window.localStorage.setItem('gp-theme', t),
      theme,
    )
  }

  await page.goto(URL, { waitUntil: 'networkidle' })
  // Long enough to clear useHeldFlag's 620ms floor, both chart reveals (~1.4s)
  // and the marker fade at 1.1s, so anything still pulsing after this is a panel
  // that never resolved rather than one mid-animation.
  await page.waitForTimeout(3500)

  const audit = await page.evaluate(() => {
    const doc = document.documentElement
    const overflowX = doc.scrollWidth - doc.clientWidth

    // A panel far taller than the ink inside it is the "empty space" failure.
    // Measuring the union of descendant text/graphic boxes against the panel's
    // own box is the closest a script gets to what a reader would call a hole.
    const hollow = []
    for (const el of document.querySelectorAll('.panel')) {
      const box = el.getBoundingClientRect()
      if (box.height < 80) continue
      let top = Infinity
      let bottom = -Infinity
      for (const child of el.querySelectorAll('*')) {
        if (child.children.length > 0) continue
        const r = child.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        top = Math.min(top, r.top)
        bottom = Math.max(bottom, r.bottom)
      }
      if (!Number.isFinite(top)) continue
      const slack = box.height - (bottom - top)
      if (slack > 90) {
        hollow.push({
          label: el.getAttribute('aria-label') ?? el.className.slice(0, 40),
          height: Math.round(box.height),
          slack: Math.round(slack),
        })
      }
    }

    const emptyText = [...document.querySelectorAll('section, aside, article')]
      .filter((el) => el.getBoundingClientRect().height > 40 && !el.textContent.trim())
      .map((el) => el.getAttribute('aria-label') ?? el.tagName)

    // A skeleton still on screen once everything has settled is a panel whose
    // data never arrived — invisible in a screenshot if you don't know the real
    // thing was meant to be there. The same class also drives the intentional,
    // permanent pulses (the MODELS LIVE dot, the chat typing dots, the bar on a
    // clip mid-analysis), and those are all small; a placeholder block is not.
    const stuck = [
      ...new Set(
        [...document.querySelectorAll('.anim-pulse')]
          .filter((el) => {
            const r = el.getBoundingClientRect()
            return r.width >= 40 && r.height >= 10
          })
          .map((el) => el.closest('[aria-label]')?.getAttribute('aria-label') ?? 'unlabelled'),
      ),
    ]

    return { overflowX, hollow, emptyText, stuck, height: doc.scrollHeight }
  })

  await page.screenshot({
    path: `shots/${width}${theme ? `-${theme}` : ''}.png`,
    fullPage: true,
  })

  const tag = `${width}px${theme ? ` (${theme})` : ''}`
  console.log(`\n── ${tag} — document ${audit.height}px tall ──`)

  if (errs.length) {
    failed = true
    console.log(`  ✗ ${errs.length} console error(s):`)
    for (const e of [...new Set(errs)].slice(0, 10)) console.log(`      ${e}`)
  } else {
    console.log('  ✓ no console errors')
  }

  if (remote.length) {
    failed = true
    console.log(`  ✗ ${remote.length} off-origin request(s) — breaks offline:`)
    for (const u of [...new Set(remote)].slice(0, 6)) console.log(`      ${u}`)
  } else {
    console.log('  ✓ no off-origin requests')
  }

  if (audit.overflowX > 1) {
    failed = true
    console.log(`  ✗ horizontal overflow: ${audit.overflowX}px past the viewport`)
  } else {
    console.log('  ✓ no horizontal overflow')
  }

  if (audit.hollow.length) {
    console.log(`  ! ${audit.hollow.length} panel(s) with >90px of vertical slack:`)
    for (const h of audit.hollow) console.log(`      ${h.label} — ${h.height}px tall, ${h.slack}px empty`)
  } else {
    console.log('  ✓ no hollow panels')
  }

  if (audit.emptyText.length) {
    failed = true
    console.log(`  ✗ rendered but textless: ${audit.emptyText.join(', ')}`)
  }

  if (audit.stuck.length) {
    failed = true
    console.log(`  ✗ still skeleton after settle: ${audit.stuck.join(', ')}`)
  } else {
    console.log('  ✓ every panel resolved')
  }

  await page.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
