const VIEWPORTS = ['desktop', 'mobile']
const CAPTURE_STATUSES = new Set([
  'BLOCKED_OR_CHALLENGED',
  'TIMEOUT',
  'HTTP_ERROR',
  'RENDER_INCOMPLETE',
])

function safeTargetId(value) {
  if (typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)) {
    return value
  }
  return 'unknown-target'
}

function captureReason(viewport) {
  const { capture_status: status, http_status: httpStatus, error } = viewport
  if (status === 'HTTP_ERROR' && Number.isInteger(httpStatus)) return `HTTP_${httpStatus}`
  if (status === 'BLOCKED_OR_CHALLENGED') {
    return Number.isInteger(httpStatus) && httpStatus >= 400
      ? `HTTP_${httpStatus}`
      : 'challenge_or_access_denied'
  }
  if (status === 'TIMEOUT') return 'navigation_timeout'

  const networkCode = typeof error === 'string' ? error.match(/\bERR_[A-Z0-9_]{1,64}\b/)?.[0] : null
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
    const targetId = safeTargetId(capture?.target_id)

    for (const viewportName of VIEWPORTS) {
      const viewport = capture.viewports?.[viewportName]
      if (!viewport) continue

      const status = viewport.capture_status
      if (CAPTURE_STATUSES.has(status)) {
        summary.push({
          target_id: targetId,
          viewport: viewportName,
          classification: 'CAPTURE',
          status,
          reason: captureReason(viewport),
        })
      }

      const reason = recommendationReason(viewport)
      if (reason) {
        summary.push({
          target_id: targetId,
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
