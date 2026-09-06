import { expect, test } from '@playwright/test'

import {
  buildRecommendationProbe,
  compareRecommendationProbes,
  recommendationFailureStage,
} from '../src/recommendation-probe.mjs'

function viewport(urls, label = 'こちらもおすすめ') {
  if (urls == null) return { recommendations: null }
  return {
    recommendations: {
      surface_label: label,
      item_count: urls.length,
      items: urls.map((url, index) => ({ rank: index + 1, title: `rec ${index + 1}`, url })),
    },
  }
}

test('failed collection is not treated as zero recommendations', () => {
  const probe = buildRecommendationProbe(viewport(null), viewport(null))
  expect(probe.collection_status).toBe('COLLECTION_FAILED')
  expect(probe.comparison_status).toBe('INCOMPARABLE')
  expect(probe.review_depth).toBeNull()
})

test('uses a populated viewport as canonical and records partial state', () => {
  const probe = buildRecommendationProbe(viewport(['https://note.com/a/n/n1']), viewport(null))
  expect(probe.collection_status).toBe('PARTIAL')
  expect(probe.canonical_viewport).toBe('desktop')
  expect(probe.review_depth).toBe(1)
})

test('diffs only comparable URL sets and ignores redacted null URLs', () => {
  const before = buildRecommendationProbe(viewport(['https://note.com/a/n/n1', 'https://note.com/b/n/n2']), viewport(['https://note.com/a/n/n1', 'https://note.com/b/n/n2']))
  const after = buildRecommendationProbe(viewport(['https://note.com/b/n/n2', 'https://note.com/c/n/n3']), viewport(['https://note.com/b/n/n2', 'https://note.com/c/n/n3']))
  before.items.push({ rank: 3, title: null, url: null })
  after.items.push({ rank: 3, title: null, url: null })
  expect(compareRecommendationProbes(before, after)).toMatchObject({
    comparison_status: 'COMPARABLE',
    retained: ['https://note.com/b/n/n2'],
    new: ['https://note.com/c/n/n3'],
    disappeared: ['https://note.com/a/n/n1'],
  })
})

test('reports worst settle failure stage', () => {
  expect(
    recommendationFailureStage(
      { recommendation_settle: { outcome: 'ROOT_WITHOUT_ITEMS' } },
      { recommendation_settle: { outcome: 'ROOT_ABSENT' } },
    ),
  ).toBe('ROOT_ABSENT')
})
