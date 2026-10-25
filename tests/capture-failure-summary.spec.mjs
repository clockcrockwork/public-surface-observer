import { expect, test } from '@playwright/test'

import { summarizeCaptureFailures } from '../src/capture-failure-summary.mjs'

test('summarizes failed capture viewports with safe reasons and no URLs', () => {
  const summary = summarizeCaptureFailures([
    {
      target_id: 'note-article-n123',
      viewports: {
        desktop: {
          capture_status: 'BLOCKED_OR_CHALLENGED',
          http_status: 403,
          error: 'blocked at https://note.com/private?token=secret',
          recommendation_settle: { surface_expected: true, outcome: 'ROOT_ABSENT' },
        },
        mobile: {
          capture_status: 'OK',
          recommendations: { item_count: 2 },
          recommendation_settle: { surface_expected: true, outcome: 'POPULATED' },
        },
      },
    },
  ])

  expect(summary).toEqual([
    {
      target_id: 'note-article-n123',
      viewport: 'desktop',
      classification: 'CAPTURE',
      status: 'BLOCKED_OR_CHALLENGED',
      reason: 'HTTP_403',
    },
    {
      target_id: 'note-article-n123',
      viewport: 'desktop',
      classification: 'RECOMMENDATION_COLLECTION',
      status: 'COLLECTION_FAILED',
      reason: 'ROOT_ABSENT',
    },
  ])
  expect(JSON.stringify(summary)).not.toContain('https://')
  expect(JSON.stringify(summary)).not.toContain('secret')
})

test('reduces navigation exception text to an allowlisted network reason', () => {
  const summary = summarizeCaptureFailures([
    {
      target_id: 'booth-shop',
      viewports: {
        desktop: {
          capture_status: 'RENDER_INCOMPLETE',
          error: 'net::ERR_CONNECTION_RESET at https://booth.pm/private?key=secret',
        },
      },
    },
  ])

  expect(summary).toEqual([
    {
      target_id: 'booth-shop',
      viewport: 'desktop',
      classification: 'CAPTURE',
      status: 'RENDER_INCOMPLETE',
      reason: 'network_ERR_CONNECTION_RESET',
    },
  ])
  expect(JSON.stringify(summary)).not.toContain('booth.pm')
  expect(JSON.stringify(summary)).not.toContain('secret')
})

test('bounds diagnostic identifiers and network reason lengths', () => {
  const summary = summarizeCaptureFailures([
    {
      target_id: `note-article-${'n'.repeat(300)}`,
      viewports: {
        desktop: {
          capture_status: 'RENDER_INCOMPLETE',
          error: `net::ERR_${'A'.repeat(100)}`,
        },
      },
    },
  ])

  expect(summary).toEqual([
    {
      target_id: 'unknown-target',
      viewport: 'desktop',
      classification: 'CAPTURE',
      status: 'RENDER_INCOMPLETE',
      reason: 'render_incomplete',
    },
  ])
  expect(JSON.stringify(summary).length).toBeLessThan(200)
})
