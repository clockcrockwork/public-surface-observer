const VIEWPORTS = ['desktop', 'mobile']
const CAPTURE_STATUSES = new Set([
  'BLOCKED_OR_CHALLENGED',
  'TIMEOUT',
  'HTTP_ERROR',
  'RENDER_INCOMPLETE',
])
const NETWORK_ERROR_CODES = new Set([
  'ERR_ABORTED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_BLOCKED_BY_CLIENT',
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_EMPTY_RESPONSE',
  'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NETWORK_CHANGED',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_TIMED_OUT',
  'ERR_TUNNEL_CONNECTION_FAILED',
])

function safeTargetId(value) {
  if (typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)) {
    return value
  }
  return 'unknown-target'
}

function captureReason(viewport) {
  const { capture_status: status, http_status: httpStatus, error } = viewport
  const hasHttpErrorStatus = Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599

  if (status === 'HTTP_ERROR' && hasHttpErrorStatus) return `HTTP_${httpStatus}`
  if (status === 'BLOCKED_OR_CHALLENGED') {
    return hasHttpErrorStatus ? `HTTP_${httpStatus}` : 'challenge_or_access_denied'
  }
  if (status === 'TIMEOUT') return 'navigation_timeout'

  const networkCode = typeof error === 'string' ? error.match(/\bERR_[A-Z0-9_]{1,64}\b/)?.[0] : null
  if (NETWORK_ERROR_CODES.has(networkCode)) return `network_${networkCode}`
  return status === 'HTTP_ERROR' ? 'capture_exception' : 'render_incomplete'
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
  for (const capture of Array.isArray(captures) ? captures : []) {
    const targetId = safeTargetId(capture?.target_id)

    for (const viewportName of VIEWPORTS) {
      const viewport = capture?.viewports?.[viewportName]
      if (!viewport || typeof viewport !== 'object') continue

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
