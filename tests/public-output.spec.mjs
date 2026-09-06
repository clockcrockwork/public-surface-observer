import { expect, test } from '@playwright/test'

import {
  assertNoManagedIdentityLeak,
  publicTargetFromCapture,
  sanitizeRecommendationProbe,
} from '../src/public-output.mjs'

const seeds = [
  {
    id: 'primary-note',
    service: 'note',
    account_key: 'private-handle',
    url: 'https://note.com/private-handle',
    enabled: true,
    discover_children: true,
  },
]

test('redacts recommendation links back to a managed account', () => {
  const probe = sanitizeRecommendationProbe(
    {
      collection_status: 'OK',
      surface_label: 'こちらもおすすめ',
      surface_model: 'UNKNOWN',
      canonical_viewport: 'desktop',
      review_depth: 2,
      classification_method: 'OTHER',
      cluster_taxonomy_version: 'UNCLASSIFIED-v0',
      comparison_status: 'COMPARABLE',
      desktop_item_count: 2,
      mobile_item_count: 2,
      mirror_consistent: true,
      items: [
        { rank: 1, title: 'self', url: 'https://note.com/private-handle/n/n1' },
        { rank: 2, title: 'other', url: 'https://note.com/other/n/n2' },
      ],
    },
    seeds,
  )
  expect(probe.items[0]).toMatchObject({ rank: 1, url: null, managed_target_redacted: true })
  expect(probe.items[1].url).toBe('https://note.com/other/n/n2')
  expect(() => assertNoManagedIdentityLeak(probe, seeds)).not.toThrow()
})

test('public target omits managed URL, page copy, and screenshots', () => {
  const target = publicTargetFromCapture(
    {
      target_id: 'note-article-n1',
      public_id: 'n1',
      service: 'note',
      page_type: 'article',
      discovery_presence: 'DISCOVERED_NOW',
      requested_url: 'https://note.com/private-handle/n/n1',
      canonical_url: 'https://note.com/private-handle/n/n1',
      capture_status: 'OK',
      http_status: 200,
      recommendation_probe: null,
      material_errors: [],
      viewports: { desktop: { visible_text: 'secret-ish copy' } },
    },
    seeds,
  )
  expect(JSON.stringify(target)).not.toContain('private-handle')
  expect(target).not.toHaveProperty('requested_url')
  expect(target).not.toHaveProperty('viewports')
})

test('identity assertion fails closed', () => {
  expect(() => assertNoManagedIdentityLeak({ url: 'https://note.com/private-handle' }, seeds)).toThrow()
})
