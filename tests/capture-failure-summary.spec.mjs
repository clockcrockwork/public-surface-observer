import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

import { summarizeCaptureFailures } from '../src/capture-failure-summary.mjs'

test('keeps diagnostic identifiers and reasons bounded and secret-free', () => {
  const summary = summarizeCaptureFailures([
    {
      target_id: ['note-article-', 'n'.repeat(300)].join(''),
      viewports: {
        desktop: {
          capture_status: 'RENDER_INCOMPLETE',
          error: ['net::ERR_', 'A'.repeat(100), ' at https://note.com/private?token=secret'].join(''),
        },
      },
    },
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
      target_id: 'unknown-target',
      viewport: 'desktop',
      classification: 'CAPTURE',
      status: 'RENDER_INCOMPLETE',
      reason: 'render_incomplete',
    },
    {
      target_id: 'booth-shop',
      viewport: 'desktop',
      classification: 'CAPTURE',
      status: 'RENDER_INCOMPLETE',
      reason: 'network_ERR_CONNECTION_RESET',
    },
  ])
  expect(JSON.stringify(summary).length).toBeLessThan(400)
  expect(JSON.stringify(summary)).not.toMatch(/https?:|note\.com|secret|private/)
})

test('classifies capture and recommendation failures by viewport', () => {
  const summary = summarizeCaptureFailures([
    {
      target_id: 'note-article-n123',
      viewports: {
        desktop: {
          capture_status: 'BLOCKED_OR_CHALLENGED',
          http_status: 403,
          recommendation_settle: { surface_expected: true, outcome: 'ROOT_ABSENT' },
        },
        mobile: {
          capture_status: 'TIMEOUT',
          recommendation_settle: { surface_expected: true, outcome: 'ROOT_WITHOUT_ITEMS' },
        },
      },
    },
    {
      target_id: 'booth-shop',
      viewports: {
        desktop: {
          capture_status: 'HTTP_ERROR',
          http_status: 503,
          recommendation_settle: { surface_expected: false, outcome: 'ROOT_ABSENT' },
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
    {
      target_id: 'note-article-n123',
      viewport: 'mobile',
      classification: 'CAPTURE',
      status: 'TIMEOUT',
      reason: 'navigation_timeout',
    },
    {
      target_id: 'note-article-n123',
      viewport: 'mobile',
      classification: 'RECOMMENDATION_COLLECTION',
      status: 'COLLECTION_FAILED',
      reason: 'ROOT_WITHOUT_ITEMS',
    },
    {
      target_id: 'booth-shop',
      viewport: 'desktop',
      classification: 'CAPTURE',
      status: 'HTTP_ERROR',
      reason: 'HTTP_503',
    },
  ])
})

test('emits diagnostics without changing blocked exit or production persist gates', () => {
  const observer = readFileSync(new URL('../src/observe.mjs', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../.github/workflows/observe.yml', import.meta.url), 'utf8')
  const persistIndex = observer.indexOf('if (args.persist)')
  const diagnosticsIndex = observer.indexOf('summarizeCaptureFailures(captures)')
  const exitIndex = observer.indexOf('process.exitCode = 2')

  expect(persistIndex).toBeGreaterThanOrEqual(0)
  expect(diagnosticsIndex).toBeGreaterThan(persistIndex)
  expect(exitIndex).toBeGreaterThan(diagnosticsIndex)
  expect(observer).toMatch(
    /if \(publicTargets\.some\(\(target\) => target\.capture_status === 'BLOCKED_OR_CHALLENGED'\)\) \{\s*process\.exitCode = 2\s*\}/,
  )
  expect(workflow).toContain(
    "if: ${{ success() && steps.target-config.outputs.skip != 'true' && github.ref == 'refs/heads/main' }}",
  )
  expect(workflow).toContain('npm run observe -- --scope "$SCOPE" --persist')
})

test('does not confuse capture exceptions with HTTP response errors', () => {
  const summary = summarizeCaptureFailures([
    {
      target_id: 'note-article-n123',
      viewports: {
        desktop: {
          capture_status: 'HTTP_ERROR',
          http_status: 200,
          error: 'page.screenshot: Target closed at https://note.com/private?access_token=secret',
        },
        mobile: {
          capture_status: 'HTTP_ERROR',
          http_status: 200,
          error: 'net::ERR_CONNECTION_RESET at https://note.com/private?access_token=secret',
        },
      },
    },
    {
      target_id: 'booth-product-123',
      viewports: {
        desktop: {
          capture_status: 'HTTP_ERROR',
          http_status: null,
          error: 'Target page closed',
        },
        mobile: {
          capture_status: 'HTTP_ERROR',
          http_status: 503,
        },
      },
    },
    {
      target_id: 'booth-shop',
      viewports: {
        desktop: {
          capture_status: 'BLOCKED_OR_CHALLENGED',
          http_status: 200,
        },
      },
    },
  ])

  expect(summary.map(({ reason }) => reason)).toEqual([
    'capture_exception',
    'network_ERR_CONNECTION_RESET',
    'capture_exception',
    'HTTP_503',
    'challenge_or_access_denied',
  ])
  expect(JSON.stringify(summary)).not.toMatch(/HTTP_200|note\.com|access_token|secret|private/)
})

test('does not echo an unrecognized ERR token embedded in an error URL', () => {
  const summary = summarizeCaptureFailures([
    {
      target_id: 'note-article-private',
      viewports: {
        desktop: {
          capture_status: 'RENDER_INCOMPLETE',
          error: 'navigation failed at https://private.example/ERR_PRIVATE_TOKEN?access_token=secret',
        },
      },
    },
  ])

  expect(summary).toEqual([
    {
      target_id: 'note-article-private',
      viewport: 'desktop',
      classification: 'CAPTURE',
      status: 'RENDER_INCOMPLETE',
      reason: 'render_incomplete',
    },
  ])
  expect(JSON.stringify(summary)).not.toMatch(/ERR_PRIVATE_TOKEN|private\\.example|secret/)
})

test('does not throw on null or malformed capture collections', () => {
  const malformed = [null, {}, { target_id: 'x', viewports: null }, { target_id: 'x', viewports: { desktop: null } }]

  expect(() => summarizeCaptureFailures(null)).not.toThrow()
  expect(() => summarizeCaptureFailures(malformed)).not.toThrow()
  expect(summarizeCaptureFailures(null)).toEqual([])
  expect(summarizeCaptureFailures(malformed)).toEqual([])
})
