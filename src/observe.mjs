#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { loadSeeds, validateOneOffUrl } from './config.mjs'
import {
  discoverNoteArticles,
  extractNotePage,
  identifyNoteTarget,
  normalizeNoteUrl,
  settleNotePage,
} from './adapters/note.mjs'
import {
  discoverBoothProducts,
  extractBoothPage,
  identifyBoothTarget,
  normalizeBoothUrl,
} from './adapters/booth.mjs'
import {
  buildRecommendationProbe,
  compareRecommendationProbes,
  recommendationCollectionStatus,
  recommendationFailureStage,
} from './recommendation-probe.mjs'
import { assertNoManagedIdentityLeak, publicTargetFromCapture } from './public-output.mjs'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const LATEST_DIR = resolve(REPO_ROOT, 'latest')
const DEFAULT_ARTIFACT_ROOT = resolve(REPO_ROOT, 'artifacts')

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

const MAX_RECOMMENDATION_ATTEMPTS = 2
const RUN_RECOMMENDATION_RETRY_BUDGET = 4

function sha256(value) {
  return createHash('sha256').update(value ?? '', 'utf8').digest('hex')
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseArgs(argv) {
  const result = { scope: 'all', url: null, persist: false, output: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--scope') result.scope = argv[++i]
    else if (arg === '--url') result.url = argv[++i]
    else if (arg === '--persist') result.persist = true
    else if (arg === '--output') result.output = argv[++i]
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!['all', 'note', 'booth', 'seed-only'].includes(result.scope)) {
    throw new Error('--scope must be all|note|booth|seed-only')
  }
  return result
}

function adapterFor(service) {
  if (service === 'note') {
    return {
      normalize: normalizeNoteUrl,
      identify: identifyNoteTarget,
      settle: (page, options) => settleNotePage(page, options),
      extract: extractNotePage,
      async discover(page, seed) {
        return discoverNoteArticles(page, seed.account_key)
      },
    }
  }
  if (service === 'booth') {
    return {
      normalize: normalizeBoothUrl,
      identify: identifyBoothTarget,
      settle: async (page) => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(200)
        await page.evaluate(() => window.scrollTo(0, 0))
        return null
      },
      extract: extractBoothPage,
      async discover(page, seed) {
        return discoverBoothProducts(page, new URL(seed.url).hostname)
      },
    }
  }
  throw new Error(`unsupported service: ${service}`)
}

function classifyStatus(httpStatus, pageText, error = null) {
  if (error) return error.includes('Timeout') ? 'TIMEOUT' : 'HTTP_ERROR'
  if (httpStatus != null && httpStatus >= 400) return 'HTTP_ERROR'
  const lower = (pageText || '').toLowerCase()
  if (
    lower.includes('captcha') ||
    lower.includes('just a moment') ||
    lower.includes('verify you are human')
  ) {
    return 'BLOCKED_OR_CHALLENGED'
  }
  if (!(pageText || '').trim()) return 'RENDER_INCOMPLETE'
  return 'OK'
}

async function waitForStablePublicView(page) {
  await page
    .evaluate(async () => {
      if (document.fonts?.ready) {
        await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2500))])
      }
    })
    .catch(() => {})
}

async function captureProfile(browser, service, url, profileName, targetDir, { pageType = null } = {}) {
  const context = await browser.newContext(PROFILES[profileName])
  const page = await context.newPage()
  let response = null
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await waitForStablePublicView(page)
    const adapter = adapterFor(service)
    const settleReport = (await adapter.settle(page, { pageType })) ?? null
    const extracted = await adapter.extract(page)
    const status = classifyStatus(response?.status() ?? null, extracted.visible_text)

    const firstPath = resolve(targetDir, `${profileName}-first.png`)
    const fullPath = resolve(targetDir, `${profileName}-full.png`)
    const textPath = resolve(targetDir, `${profileName}-visible.txt`)
    const metaPath = resolve(targetDir, `${profileName}-meta.json`)
    mkdirSync(targetDir, { recursive: true })

    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
    await page.screenshot({ path: firstPath, fullPage: false })
    await page.screenshot({ path: fullPath, fullPage: true })
    writeFileSync(textPath, extracted.visible_text, 'utf8')

    const meta = {
      profile: profileName,
      requested_url: url,
      final_url: page.url(),
      http_status: response?.status() ?? null,
      capture_status: status,
      document_title: extracted.document_title,
      canonical_url: extracted.canonical_url,
      meta_description: extracted.meta_description,
      og_title: extracted.og_title,
      og_description: extracted.og_description,
      og_image: extracted.og_image,
      headings: extracted.headings,
      tags: extracted.tags ?? [],
      recommendations: extracted.recommendations ?? null,
      recommendation_settle: settleReport,
      links: extracted.links,
      visible_text_sha256: sha256(extracted.visible_text),
    }
    writeJson(metaPath, meta)

    return {
      ...meta,
      screenshot_paths: {
        first: relative(REPO_ROOT, firstPath),
        full: relative(REPO_ROOT, fullPath),
      },
      visible_text_path: relative(REPO_ROOT, textPath),
      meta_path: relative(REPO_ROOT, metaPath),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      profile: profileName,
      requested_url: url,
      final_url: page.url() || url,
      http_status: response?.status() ?? null,
      capture_status: classifyStatus(response?.status() ?? null, '', message),
      error: message,
      recommendations: null,
      recommendation_settle: null,
      tags: [],
    }
  } finally {
    await page.close().catch(() => {})
    await context.close()
  }
}

function captureStatusOf(desktop, mobile) {
  const statuses = [desktop.capture_status, mobile.capture_status]
  if (statuses.every((value) => value === 'OK')) return 'OK'
  if (statuses.includes('BLOCKED_OR_CHALLENGED')) return 'BLOCKED_OR_CHALLENGED'
  if (statuses.includes('TIMEOUT')) return 'TIMEOUT'
  if (statuses.includes('HTTP_ERROR')) return 'HTTP_ERROR'
  return 'RENDER_INCOMPLETE'
}

async function captureTarget(browser, target, runDir, retryBudget) {
  const targetDir = resolve(runDir, 'pages', target.targetId)
  const probesRecommendations = target.service === 'note' && target.pageType === 'article'

  let attempt = 0
  let desktop = null
  let mobile = null
  let probe = null
  const attemptLog = []

  while (attempt < MAX_RECOMMENDATION_ATTEMPTS) {
    attempt += 1
    desktop = await captureProfile(browser, target.service, target.url, 'desktop', targetDir, {
      pageType: target.pageType,
    })
    mobile = await captureProfile(browser, target.service, target.url, 'mobile', targetDir, {
      pageType: target.pageType,
    })
    probe = probesRecommendations ? buildRecommendationProbe(desktop, mobile) : null

    if (probesRecommendations) {
      attemptLog.push({
        attempt,
        collection_status: probe.collection_status,
        desktop_settle: desktop.recommendation_settle?.outcome ?? null,
        mobile_settle: mobile.recommendation_settle?.outcome ?? null,
      })
    }

    if (!probesRecommendations || probe.collection_status !== 'COLLECTION_FAILED') break
    if (attempt >= MAX_RECOMMENDATION_ATTEMPTS || retryBudget.remaining <= 0) break
    retryBudget.remaining -= 1
  }

  if (probesRecommendations) {
    probe = {
      ...probe,
      failure_stage:
        probe.collection_status === 'COLLECTION_FAILED'
          ? recommendationFailureStage(desktop, mobile)
          : null,
      attempts: attemptLog,
    }
  }

  return {
    target_id: target.targetId,
    public_id: target.publicId ?? null,
    source_seed_id: target.sourceSeedId,
    service: target.service,
    page_type: target.pageType,
    discovery_presence: target.discoveryPresence,
    requested_url: target.url,
    final_url: desktop.final_url || mobile.final_url || target.url,
    canonical_url: desktop.canonical_url || mobile.canonical_url || null,
    http_status: desktop.http_status ?? mobile.http_status ?? null,
    capture_status: captureStatusOf(desktop, mobile),
    viewports: { desktop, mobile },
    recommendation_probe: probe,
    material_errors: [desktop.error, mobile.error].filter(Boolean),
  }
}

function buildDiff(previous, current) {
  if (!previous?.targets) return { baseline: true, targets: [] }
  const previousTargets = new Map(previous.targets.map((target) => [target.target_id, target]))
  const currentIds = new Set(current.targets.map((target) => target.target_id))
  const targets = []

  for (const target of current.targets) {
    const before = previousTargets.get(target.target_id)
    if (!before) {
      targets.push({ target_id: target.target_id, status: 'NEW_TARGET' })
      continue
    }
    targets.push({
      target_id: target.target_id,
      status: 'EXISTING_TARGET',
      capture_status_changed: before.capture_status !== target.capture_status,
      recommendation:
        target.service === 'note' && target.page_type === 'article'
          ? compareRecommendationProbes(before.recommendation_probe, target.recommendation_probe)
          : null,
    })
  }

  for (const before of previous.targets) {
    if (!currentIds.has(before.target_id)) {
      targets.push({ target_id: before.target_id, status: 'NOT_OBSERVED_THIS_RUN' })
    }
  }
  return { baseline: false, targets }
}

function buildSummary(manifest) {
  const ok = manifest.targets.filter((target) => target.capture_status === 'OK').length
  const noteArticles = manifest.targets.filter(
    (target) => target.service === 'note' && target.page_type === 'article',
  )
  const collected = noteArticles.filter(
    (target) => recommendationCollectionStatus(target.recommendation_probe) !== 'COLLECTION_FAILED',
  )
  const failures = noteArticles.length - collected.length
  const lines = [
    '# Public Surface Observation',
    '',
    `- observed_at: ${manifest.observed_at}`,
    `- status: ${manifest.status}`,
    `- targets: ${manifest.targets.length}`,
    `- OK: ${ok}`,
    `- failed/partial: ${manifest.targets.length - ok}`,
    `- note recommendation probes: ${collected.length}/${noteArticles.length}`,
    `- recommendation collection failures: ${failures}`,
    '',
    '## Recommendation neighborhood',
    '',
  ]

  for (const target of noteArticles) {
    const probe = target.recommendation_probe
    const status = recommendationCollectionStatus(probe)
    if (status === 'COLLECTION_FAILED') {
      lines.push(
        `- ${target.target_id}: COLLECTION_FAILED; stage=${probe?.failure_stage ?? 'NOT_OBSERVED'}; attempts=${probe?.attempts?.length ?? 0}; comparison=INCOMPARABLE`,
      )
      continue
    }
    const mirror =
      probe.mirror_consistent == null ? 'PARTIAL' : probe.mirror_consistent ? 'consistent' : 'DIFF'
    lines.push(
      `- ${target.target_id}: ${probe.review_depth} items; collection=${status}; desktop/mobile mirror=${mirror}`,
    )
  }
  if (noteArticles.length === 0) lines.push('- none')
  lines.push('', '> Recommendation surfaces are bounded anonymous observations. `surface_model` remains `UNKNOWN`.', '')
  return lines.join('\n')
}

async function discoverChildren(browser, seed, adapter) {
  const context = await browser.newContext(PROFILES.desktop)
  const page = await context.newPage()
  try {
    await page.goto(seed.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await waitForStablePublicView(page)
    return await adapter.discover(page, seed)
  } finally {
    await page.close().catch(() => {})
    await context.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const now = new Date().toISOString()
  const runId = now.replace(/[:.]/g, '-')
  const runDir = resolve(args.output || DEFAULT_ARTIFACT_ROOT, `run-${runId}`)
  mkdirSync(runDir, { recursive: true })

  let seeds
  let registrySchemaVersion = null
  if (args.url) {
    const validated = validateOneOffUrl(args.url)
    const identity = adapterFor(validated.service).identify(validated.url)
    seeds = [
      {
        id: 'one-off',
        service: validated.service,
        account_key: identity.accountKey,
        url: validated.url,
        enabled: true,
        discover_children: false,
      },
    ]
  } else {
    const registry = loadSeeds()
    registrySchemaVersion = registry.schemaVersion
    seeds = registry.seeds.filter((seed) => seed.enabled)
  }

  seeds = seeds.filter((seed) => args.scope === 'all' || args.scope === 'seed-only' || seed.service === args.scope)
  if (!args.url && seeds.length === 0) throw new Error('no enabled seeds for requested scope')

  const browser = await chromium.launch()
  const retryBudget = { remaining: RUN_RECOMMENDATION_RETRY_BUDGET }
  const targetMap = new Map()
  const seedReports = []

  try {
    for (const seed of seeds) {
      const adapter = adapterFor(seed.service)
      const identity = adapter.identify(seed.url)
      const seedTarget = {
        targetId: identity.targetId,
        publicId: identity.publicId,
        sourceSeedId: seed.id,
        service: seed.service,
        pageType: identity.pageType,
        url: seed.url,
        discoveryPresence: 'SEED',
      }
      targetMap.set(`${seed.id}:${seedTarget.targetId}`, seedTarget)

      let discovered = []
      if (!args.url && args.scope !== 'seed-only' && seed.discover_children) {
        try {
          discovered = await discoverChildren(browser, seed, adapter)
        } catch {
          seedReports.push({ seed_id: seed.id, discovery_status: 'FAILED', discovered_now_count: 0 })
          discovered = []
        }
      }

      for (const url of discovered) {
        const child = adapter.identify(url)
        const target = {
          targetId: child.targetId,
          publicId: child.publicId,
          sourceSeedId: seed.id,
          service: seed.service,
          pageType: child.pageType,
          url,
          discoveryPresence: 'DISCOVERED_NOW',
        }
        targetMap.set(`${seed.id}:${target.targetId}`, target)
      }
      if (!seedReports.some((report) => report.seed_id === seed.id)) {
        seedReports.push({ seed_id: seed.id, discovery_status: 'OK', discovered_now_count: discovered.length })
      }
    }

    const captures = []
    for (const target of targetMap.values()) {
      captures.push(await captureTarget(browser, target, runDir, retryBudget))
    }

    if (args.url) {
      writeJson(resolve(runDir, 'manifest.json'), {
        schema_version: 1,
        observed_at: now,
        one_off: true,
        targets: captures,
      })
      console.log(`One-off observation complete: ${captures.length} target(s)`)
      return
    }

    const publicTargets = captures.map((capture) => publicTargetFromCapture(capture, seeds))
    const hasRecommendationCollectionFailure = publicTargets.some(
      (target) =>
        target.service === 'note' &&
        target.page_type === 'article' &&
        recommendationCollectionStatus(target.recommendation_probe) === 'COLLECTION_FAILED',
    )

    const manifest = {
      schema_version: 1,
      observed_at: now,
      registry_schema_version: registrySchemaVersion,
      registry_commit_sha: process.env.GITHUB_SHA ?? null,
      runner: 'public-surface-observer',
      browser_version: await browser.version(),
      recommendation_retry_budget: {
        total: RUN_RECOMMENDATION_RETRY_BUDGET,
        remaining: retryBudget.remaining,
        max_attempts_per_target: MAX_RECOMMENDATION_ATTEMPTS,
      },
      status:
        publicTargets.every((target) => target.capture_status === 'OK') && !hasRecommendationCollectionFailure
          ? 'OK'
          : 'PARTIAL',
      seed_count: seeds.length,
      target_count: publicTargets.length,
      seed_reports: seedReports,
      targets: publicTargets,
    }

    assertNoManagedIdentityLeak(manifest, seeds)
    const previous = readJson(resolve(LATEST_DIR, 'manifest.json'), null)
    const diff = buildDiff(previous, manifest)
    assertNoManagedIdentityLeak(diff, seeds)
    const summary = buildSummary(manifest)
    assertNoManagedIdentityLeak(summary, seeds)

    writeJson(resolve(runDir, 'public-manifest.json'), manifest)
    writeJson(resolve(runDir, 'public-diff.json'), diff)
    writeFileSync(resolve(runDir, 'public-summary.md'), `${summary}\n`, 'utf8')

    if (args.persist) {
      writeJson(resolve(LATEST_DIR, 'manifest.json'), manifest)
      writeJson(resolve(LATEST_DIR, 'diff.json'), diff)
      writeFileSync(resolve(LATEST_DIR, 'summary.md'), `${summary}\n`, 'utf8')
    }

    console.log(`Observation ${manifest.status}: ${publicTargets.length} targets`)
    console.log(summary)
    if (publicTargets.some((target) => target.capture_status === 'BLOCKED_OR_CHALLENGED')) {
      process.exitCode = 2
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
