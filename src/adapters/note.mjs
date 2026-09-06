export const RECOMMENDATION_SURFACE_SELECTOR = 'aside[aria-label="こちらもおすすめ"]'

const ARTICLE_PATH = /^\/([^/]+)\/n\/([A-Za-z0-9_-]+)\/?$/

export function normalizeNoteUrl(url) {
  const parsed = new URL(url, 'https://note.com')
  parsed.hash = ''
  parsed.search = ''
  if (parsed.hostname !== 'note.com') throw new Error(`not a note.com URL: ${url}`)
  return parsed.toString()
}

export function identifyNoteTarget(url) {
  const parsed = new URL(normalizeNoteUrl(url))
  const match = parsed.pathname.match(ARTICLE_PATH)
  if (match) {
    return {
      service: 'note',
      pageType: 'article',
      accountKey: match[1],
      publicId: match[2],
      targetId: `note-article-${match[2]}`,
    }
  }
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length === 1) {
    return {
      service: 'note',
      pageType: 'creator',
      accountKey: parts[0],
      publicId: null,
      targetId: 'note-creator',
    }
  }
  return {
    service: 'note',
    pageType: 'other',
    accountKey: parts[0] ?? '',
    publicId: null,
    targetId: `note-other-${Buffer.from(parsed.pathname).toString('base64url').slice(0, 18)}`,
  }
}

export async function discoverNoteArticles(page, accountKey, { maxScrolls = 8, maxArticles = 100 } = {}) {
  for (let i = 0; i < maxScrolls; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(250)
  }
  await page.evaluate(() => window.scrollTo(0, 0))

  const urls = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => a.href).filter(Boolean),
  )

  const normalized = []
  const seen = new Set()
  for (const href of urls) {
    let url
    let target
    try {
      url = normalizeNoteUrl(href)
      target = identifyNoteTarget(url)
    } catch {
      continue
    }
    if (target.pageType !== 'article' || target.accountKey !== accountKey) continue
    if (seen.has(url)) continue
    seen.add(url)
    normalized.push(url)
    if (normalized.length >= maxArticles) break
  }
  return normalized
}

export const RECOMMENDATION_SETTLE_BUDGET_MS = 25_000
const HYDRATION_BUDGET_MS = 15_000
const MAX_HYDRATION_PASSES = 24
const ITEM_STABILIZATION_BUDGET_MS = 3_000
const ARTICLE_LINK_SELECTOR = `${RECOMMENDATION_SURFACE_SELECTOR} a[href*="/n/"]`

async function scrollSweep(page) {
  return page.evaluate(async () => {
    const step = Math.max(window.innerHeight, 600)
    const maxY = Math.min(document.documentElement.scrollHeight, step * 40)
    for (let y = 0; y < maxY; y += step) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 35))
    }
    window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight))
    await new Promise((resolve) => setTimeout(resolve, 35))
    return document.documentElement.scrollHeight
  })
}

async function countArticleLinks(page) {
  return page
    .evaluate((selector) => document.querySelectorAll(selector).length, ARTICLE_LINK_SELECTOR)
    .catch(() => 0)
}

export async function settleNotePage(
  page,
  { budgetMs = RECOMMENDATION_SETTLE_BUDGET_MS, pageType = 'article' } = {},
) {
  const waitForSurface = pageType === 'article'
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  const remaining = () => budgetMs - elapsed()
  const stages = []

  let docHeight = null
  let rootAppearedMs = null
  let hydrationPasses = 0

  const hydrationBudgetMs = Math.min(budgetMs, HYDRATION_BUDGET_MS)
  for (let pass = 0; pass < MAX_HYDRATION_PASSES; pass += 1) {
    hydrationPasses = pass + 1
    docHeight = await scrollSweep(page).catch(() => docHeight)
    const rootCount = await page.locator(RECOMMENDATION_SURFACE_SELECTOR).count().catch(() => 0)
    stages.push({
      stage: 'HYDRATION_SWEEP',
      pass: hydrationPasses,
      doc_height: docHeight,
      root_count: rootCount,
      at_ms: elapsed(),
    })
    if (rootCount > 0) {
      rootAppearedMs = elapsed()
      break
    }
    if (!waitForSurface) break
    if (elapsed() >= hydrationBudgetMs) break
    await page.waitForTimeout(Math.min(500, Math.max(0, hydrationBudgetMs - elapsed())))
  }

  let itemsPopulatedMs = null
  let articleLinkCount = 0

  if (rootAppearedMs != null) {
    const root = page.locator(RECOMMENDATION_SURFACE_SELECTOR).first()
    await root
      .scrollIntoViewIfNeeded({ timeout: Math.max(1_000, Math.min(5_000, remaining())) })
      .catch(() => {})
    stages.push({ stage: 'ROOT_IN_VIEW', at_ms: elapsed() })

    if (remaining() > 0) {
      await page
        .waitForFunction(
          (selector) => Boolean(document.querySelector(selector)),
          ARTICLE_LINK_SELECTOR,
          { timeout: remaining() },
        )
        .catch(() => {})
    }
    articleLinkCount = await countArticleLinks(page)
    if (articleLinkCount > 0) {
      itemsPopulatedMs = elapsed()
      stages.push({ stage: 'FIRST_ITEM', article_links: articleLinkCount, at_ms: elapsed() })

      const stabilizationDeadline =
        Date.now() + Math.min(ITEM_STABILIZATION_BUDGET_MS, Math.max(0, remaining()))
      let stableTicks = 0
      while (Date.now() < stabilizationDeadline && stableTicks < 2) {
        await page.waitForTimeout(250)
        const next = await countArticleLinks(page)
        if (next === articleLinkCount) stableTicks += 1
        else {
          stableTicks = 0
          articleLinkCount = next
        }
      }
      stages.push({ stage: 'ITEMS_SETTLED', article_links: articleLinkCount, at_ms: elapsed() })
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})

  const outcome =
    itemsPopulatedMs != null
      ? 'POPULATED'
      : rootAppearedMs != null
        ? 'ROOT_WITHOUT_ITEMS'
        : 'ROOT_ABSENT'

  return {
    surface_selector: RECOMMENDATION_SURFACE_SELECTOR,
    surface_expected: waitForSurface,
    outcome,
    budget_ms: budgetMs,
    elapsed_ms: elapsed(),
    hydration_passes: hydrationPasses,
    final_doc_height: docHeight,
    root_appeared_at_ms: rootAppearedMs,
    items_populated_at_ms: itemsPopulatedMs,
    article_link_count: articleLinkCount,
    stages,
  }
}

export async function extractNotePage(page) {
  return page.evaluate(() => {
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || location.href
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || null
    const article = document.querySelector('article') || document.querySelector('main') || document.body
    const tagLinks = [...article.querySelectorAll('a[href*="/hashtag/"]')]
    const tags = [...new Set(tagLinks.map((a) => (a.textContent || '').trim()).filter(Boolean))]
    const headings = [...article.querySelectorAll('h1,h2,h3')]
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)

    const recommendationSurface = document.querySelector('aside[aria-label="こちらもおすすめ"]')
    let recommendations = null
    if (recommendationSurface) {
      const figures = [...recommendationSurface.querySelectorAll('figure')]
      const items = []
      const seen = new Set()
      for (const figure of figures) {
        const link = figure.querySelector(
          'a[href*="/n/"][aria-label], a[href*="/n/"][title], a[href*="/n/"]',
        )
        if (!link) continue
        const href = link.getAttribute('href')
        if (!href) continue
        const absolute = new URL(href, document.baseURI).toString()
        if (seen.has(absolute)) continue
        seen.add(absolute)
        const creatorLink = figure.querySelector(
          '.o-horizontalTimeLineNote__user a[href], a.fn[href]:not([href*="/n/"])',
        )
        const creatorName = creatorLink?.textContent?.trim() || null
        const creatorHref = creatorLink?.getAttribute('href') || null
        const price = figure.querySelector('.m-noteBodyStatus__Price')?.textContent?.trim() || null
        const likeNode = [...figure.querySelectorAll('[aria-label]')].find((node) =>
          /^\d+$/.test(node.getAttribute('aria-label') || ''),
        )
        items.push({
          rank: items.length + 1,
          title:
            link.getAttribute('title') ||
            link.getAttribute('aria-label') ||
            figure.querySelector('h3')?.textContent?.trim() ||
            '',
          url: absolute,
          creator_name: creatorName,
          creator_url: creatorHref ? new URL(creatorHref, document.baseURI).toString() : null,
          price,
          like_count: likeNode ? Number(likeNode.getAttribute('aria-label')) : null,
        })
      }
      recommendations = {
        surface_label: recommendationSurface.getAttribute('aria-label') || 'こちらもおすすめ',
        surface_model: 'UNKNOWN',
        item_count: items.length,
        items,
      }
    }

    return {
      document_title: document.title,
      canonical_url: canonical,
      meta_description: meta('meta[name="description"]'),
      og_title: meta('meta[property="og:title"]'),
      og_description: meta('meta[property="og:description"]'),
      og_image: meta('meta[property="og:image"]'),
      visible_text: document.body.innerText || '',
      headings,
      tags,
      recommendations,
      links: [...document.querySelectorAll('a[href]')].slice(0, 1000).map((a) => ({
        text: (a.textContent || '').trim(),
        href: new URL(a.getAttribute('href'), document.baseURI).toString(),
      })),
    }
  })
}
