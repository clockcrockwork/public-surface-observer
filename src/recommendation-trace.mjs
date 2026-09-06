#!/usr/bin/env node
// Local diagnostic-only entrypoint. It never writes managed observation state.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { chromium } from '@playwright/test'

import { RECOMMENDATION_SURFACE_SELECTOR } from './adapters/note.mjs'
import { validateOneOffUrl } from './config.mjs'

const PROFILES = {
  desktop: {
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    isMobile: true,
    hasTouch: true,
  },
}

function parseArgs(argv) {
  const result = { urls: [], profiles: ['desktop', 'mobile'], attempts: 3, budgetMs: 45_000, output: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--url') result.urls.push(argv[++i])
    else if (arg === '--profiles') result.profiles = argv[++i].split(',').filter(Boolean)
    else if (arg === '--attempts') result.attempts = Number(argv[++i])
    else if (arg === '--budget-ms') result.budgetMs = Number(argv[++i])
    else if (arg === '--output') result.output = argv[++i]
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (result.urls.length === 0) throw new Error('at least one --url is required')
  for (const url of result.urls) {
    const validated = validateOneOffUrl(url)
    if (validated.service !== 'note') throw new Error('recommendation trace accepts note URLs only')
  }
  return result
}

function sampleSurface(selector) {
  const root = document.querySelector(selector)
  const rect = root ? root.getBoundingClientRect() : null
  return {
    doc_height: document.documentElement.scrollHeight,
    scroll_y: Math.round(window.scrollY),
    ready_state: document.readyState,
    root_present: Boolean(root),
    root_in_viewport: rect ? rect.top < window.innerHeight && rect.bottom > 0 : null,
    figures: root ? root.querySelectorAll('figure').length : 0,
    article_links: root ? root.querySelectorAll('a[href*="/n/"]').length : 0,
    skeletons: root ? root.querySelectorAll('[class*="keleton"]').length : 0,
  }
}

async function traceAttempt(browser, url, profileName, { attempt, budgetMs }) {
  const context = await browser.newContext(PROFILES[profileName])
  const page = await context.newPage()
  const started = Date.now()
  const at = () => Date.now() - started
  const samples = []
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    while (at() < budgetMs) {
      const sample = { t: at(), ...(await page.evaluate(sampleSurface, RECOMMENDATION_SURFACE_SELECTOR)) }
      samples.push(sample)
      if (sample.article_links > 0) break
      if (sample.root_present && sample.root_in_viewport === false) {
        await page.locator(RECOMMENDATION_SURFACE_SELECTOR).first().scrollIntoViewIfNeeded().catch(() => {})
      } else {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)).catch(() => {})
      }
      await page.waitForTimeout(1000)
    }
  } finally {
    await page.close().catch(() => {})
    await context.close()
  }
  const populated = samples.find((sample) => sample.article_links > 0) ?? null
  const last = samples.at(-1) ?? null
  return {
    profile: profileName,
    attempt,
    outcome: populated ? 'POPULATED' : last?.root_present ? 'ROOT_WITHOUT_ITEMS' : 'ROOT_ABSENT',
    populated_at_ms: populated?.t ?? null,
    root_first_seen_ms: samples.find((sample) => sample.root_present)?.t ?? null,
    samples,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const browser = await chromium.launch()
  const attempts = []
  try {
    for (const url of args.urls) {
      for (const profile of args.profiles) {
        for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
          const trace = await traceAttempt(browser, url, profile, { attempt, budgetMs: args.budgetMs })
          attempts.push({ url, ...trace })
          console.log(`${profile} #${attempt}: ${trace.outcome}`)
        }
      }
    }
  } finally {
    await browser.close()
  }
  if (args.output) {
    mkdirSync(dirname(resolve(args.output)), { recursive: true })
    writeFileSync(resolve(args.output), `${JSON.stringify({ generated_at: new Date().toISOString(), attempts }, null, 2)}\n`, 'utf8')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
