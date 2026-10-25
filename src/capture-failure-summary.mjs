const VIEWPORTS = ['desktop', 'mobile']
const CAPTURE_STATUSES = new Set([
  'BLOCKED_OR_CHALLENGED',
  'TIMEOUT',
  'HTTP_ERROR',
  'RENDER_INCOMPLETE',
])

function captureReason(viewport) {
  const { capture_status: status, http_status: httpStatus, error } = viewport
  if (status === 'HTTP_ERROR' && Number.isInteger(httpStatus)) return `HTTP_${httpStatus}`
  if (status === 'BLOCKED_OR_CHALLENGED') {
    return Number.isInteger(httpStatus) && httpStatus >= 400
      ? `HTTP_${httpStatus}`
      : 'challenge_or_access_denied'
  }
  if (status === 'TIMEOUT') return 'navigation_timeout'

  const networkCode = typeof error === 'string' ? error.match(/\\bERR_[A-Z0-9_]+\\b/)?.[0] : null
  return networkCode ? `network_${networkCode}` : 'render_incomplete'
}

function recommendationReason(viewport) {
  const settle = viewport.recommendation_settle
  if (settle?.surface_expected !== true) return null

  const outcome = settle.outcome
  if (outcome === 'POPULATED' && (viewport.recommendations?.item_count ?? 0) > 0) return null
  if (outcome === 'POPULATED') return 'POPULATED_BUT_UNPARSED'
  if (outcome === 'ROOT_ABSENT' || outcome === 'ROOT_WITHOUT_ITEMS') return outcome
  return 'SETTLE_FAILED'
}

export function summarizeCaptureFailures(captures) {
  const summary = []
  for (const capture of captures) {
    if (typeof capture?.target_id !== 'string') continue

    for (const viewportName of VIEWPORTS) {
      const viewport = capture.viewports?.[viewportName]
      if (!viewport) continue

      const status = viewport.capture_status
      if (CAPTURE_STATUSES.has(status)) {
        summary.push({
          target_id: capture.target_id,
          viewport: viewportName,
          classification: 'CAPTURE',
          status,
          reason: captureReason(viewport),
        })
      }

      const reason = recommendationReason(viewport)
      if (reason) {
        summary.push({
          target_id: capture.target_id,
          viewport: viewportName,
          classification: 'RECOMMENDATION_COLLECTION',
          status: 'COLLECTION_FAILED',
          reason,
        })
      }
    }
  }
  return summary
}
