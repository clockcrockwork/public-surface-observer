const ITEM_PATH = /^\/items\/(\d+)\/?$/

export function normalizeBoothUrl(url) {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.search = ''
  if (!(parsed.hostname === 'booth.pm' || parsed.hostname.endsWith('.booth.pm'))) {
    throw new Error(`not a BOOTH URL: ${url}`)
  }
  return parsed.toString()
}

export function identifyBoothTarget(url) {
  const parsed = new URL(normalizeBoothUrl(url))
  const match = parsed.pathname.match(ITEM_PATH)
  if (match) {
    return {
      service: 'booth',
      pageType: 'product',
      accountKey: parsed.hostname.endsWith('.booth.pm') ? parsed.hostname.slice(0, -'.booth.pm'.length) : '',
      publicId: match[1],
      targetId: `booth-product-${match[1]}`,
    }
  }
  return {
    service: 'booth',
    pageType: 'shop',
    accountKey: parsed.hostname.endsWith('.booth.pm') ? parsed.hostname.slice(0, -'.booth.pm'.length) : '',
    publicId: null,
    targetId: 'booth-shop',
  }
}

export async function discoverBoothProducts(page, shopHost, { maxScrolls = 6, maxProducts = 100 } = {}) {
  for (let i = 0; i < maxScrolls; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(250)
  }
  await page.evaluate(() => window.scrollTo(0, 0))

  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href))
  const found = []
  const seen = new Set()
  for (const href of hrefs) {
    let parsed
    try {
      parsed = new URL(href)
    } catch {
      continue
    }
    if (parsed.hostname !== shopHost && parsed.hostname !== 'booth.pm') continue
    if (!ITEM_PATH.test(parsed.pathname)) continue
    const normalized = normalizeBoothUrl(parsed.toString())
    if (seen.has(normalized)) continue
    seen.add(normalized)
    found.push(normalized)
    if (found.length >= maxProducts) break
  }
  return found
}

export async function extractBoothPage(page) {
  return page.evaluate(() => {
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || null
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || location.href
    return {
      document_title: document.title,
      canonical_url: canonical,
      meta_description: meta('meta[name="description"]'),
      og_title: meta('meta[property="og:title"]'),
      og_description: meta('meta[property="og:description"]'),
      og_image: meta('meta[property="og:image"]'),
      visible_text: document.body.innerText || '',
      headings: [...document.querySelectorAll('h1,h2,h3')]
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean),
      links: [...document.querySelectorAll('a[href]')].slice(0, 1000).map((a) => ({
        text: (a.textContent || '').trim(),
        href: a.href,
      })),
    }
  })
}
