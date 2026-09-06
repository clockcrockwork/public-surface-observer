import { expect, test } from '@playwright/test'

import { extractNotePage, settleNotePage } from '../src/adapters/note.mjs'

function lazyArticleHtml({ rootDelayMs, itemsDelayMs, itemCount = 3 }) {
  return `<!doctype html><html><head><base href="https://note.com/"></head><body>
  <article><h1>Target</h1><div style="height:2400px"></div></article><div id="mount"></div>
  <script>
    setTimeout(() => {
      const aside = document.createElement('aside')
      aside.setAttribute('aria-label', 'こちらもおすすめ')
      aside.innerHTML = '<div class="skeleton"></div>'
      document.getElementById('mount').appendChild(aside)
      setTimeout(() => {
        aside.innerHTML = Array.from({ length: ${itemCount} }, (_, i) =>
          '<figure><a href="/alice/n/n' + (i + 1) + '" title="rec ' + (i + 1) + '"></a></figure>').join('')
      }, ${itemsDelayMs})
    }, ${rootDelayMs})
  </script></body></html>`
}

test('waits for a recommendation root that is not in the DOM yet', async ({ page }) => {
  await page.setContent(lazyArticleHtml({ rootDelayMs: 1200, itemsDelayMs: 300 }))
  const report = await settleNotePage(page, { budgetMs: 10_000 })
  expect(report.outcome).toBe('POPULATED')
  expect(report.article_link_count).toBe(3)
  expect((await extractNotePage(page)).recommendations?.item_count).toBe(3)
})

test('reports ROOT_ABSENT instead of inventing zero recommendations', async ({ page }) => {
  await page.setContent(lazyArticleHtml({ rootDelayMs: 60_000, itemsDelayMs: 0 }))
  const report = await settleNotePage(page, { budgetMs: 2_000 })
  expect(report.outcome).toBe('ROOT_ABSENT')
  expect((await extractNotePage(page)).recommendations).toBeNull()
})

test('reports ROOT_WITHOUT_ITEMS for persistent skeleton', async ({ page }) => {
  await page.setContent(lazyArticleHtml({ rootDelayMs: 0, itemsDelayMs: 60_000 }))
  const report = await settleNotePage(page, { budgetMs: 2500 })
  expect(report.outcome).toBe('ROOT_WITHOUT_ITEMS')
})
