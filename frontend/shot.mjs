import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errs = []
p.on('console', m => m.type() === 'error' && errs.push(m.text()))
p.on('pageerror', e => errs.push(String(e)))
await p.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await p.waitForTimeout(4000)
await p.screenshot({ path: '/tmp/real.png', fullPage: true })
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors')
await b.close()
