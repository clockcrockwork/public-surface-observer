import { expect, test } from '@playwright/test'

import { extractNotePage, identifyNoteTarget, normalizeNoteUrl } from '../src/adapters/note.mjs'

test('note URL normalization and identity are account-neutral', () => {
  expect(normalizeNoteUrl('https://note.com/example/n/nabc?x=1#y')).toBe('https://note.com/example/n/nabc')
  expect(identifyNoteTarget('https://note.com/example/n/nabc')).toMatchObject({
    pageType: 'article',
    accountKey: 'example',
    publicId: 'nabc',
    targetId: 'note-article-nabc',
  })
})

test('extracts and deduplicates rendered recommendation cards', async ({ page }) => {
  await page.setContent(`<!doctype html><html><head><base href="https://note.com/"></head><body>
    <article><h1>Target</h1></article>
    <aside aria-label="こちらもおすすめ">
      <figure><a href="/alice/n/n1" title="First"></a></figure>
      <figure><a href="/alice/n/n1" title="Duplicate"></a></figure>
      <figure><a href="/bob/n/n2" title="Second"></a></figure>
    </aside>
  </body></html>`)
  const extracted = await extractNotePage(page)
  expect(extracted.recommendations?.item_count).toBe(2)
  expect(extracted.recommendations?.items.map((item) => item.url)).toEqual([
    'https://note.com/alice/n/n1',
    'https://note.com/bob/n/n2',
  ])
})
