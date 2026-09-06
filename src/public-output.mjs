function normalizeUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function managedNoteKeys(seeds) {
  return new Set(seeds.filter((seed) => seed.service === 'note').map((seed) => seed.account_key))
}

function managedBoothHosts(seeds) {
  return new Set(
    seeds
      .filter((seed) => seed.service === 'booth')
      .map((seed) => normalizeUrl(seed.url)?.hostname)
      .filter(Boolean),
  )
}

export function isManagedUrl(value, seeds) {
  const parsed = normalizeUrl(value)
  if (!parsed) return false

  if (parsed.hostname === 'note.com') {
    const key = parsed.pathname.split('/').filter(Boolean)[0] ?? ''
    return managedNoteKeys(seeds).has(key)
  }

  if (parsed.hostname === 'booth.pm' || parsed.hostname.endsWith('.booth.pm')) {
    const hosts = managedBoothHosts(seeds)
    if (hosts.has(parsed.hostname)) return true
  }
  return false
}

function sanitizeRecommendationItem(item, seeds) {
  if (isManagedUrl(item?.url, seeds) || isManagedUrl(item?.creator_url, seeds)) {
    return {
      rank: item?.rank ?? null,
      title: null,
      url: null,
      creator_name: null,
      creator_url: null,
      price: null,
      like_count: null,
      managed_target_redacted: true,
    }
  }
  return {
    rank: item?.rank ?? null,
    title: item?.title ?? '',
    url: item?.url ?? null,
    creator_name: item?.creator_name ?? null,
    creator_url: item?.creator_url ?? null,
    price: item?.price ?? null,
    like_count: item?.like_count ?? null,
  }
}

export function sanitizeRecommendationProbe(probe, seeds) {
  if (!probe) return null
  return {
    collection_status: probe.collection_status ?? 'COLLECTION_FAILED',
    failure_reason: probe.failure_reason ?? null,
    failure_stage: probe.failure_stage ?? null,
    attempts: Array.isArray(probe.attempts)
      ? probe.attempts.map((attempt) => ({
          attempt: attempt.attempt,
          collection_status: attempt.collection_status,
          desktop_settle: attempt.desktop_settle,
          mobile_settle: attempt.mobile_settle,
        }))
      : [],
    surface_label: probe.surface_label ?? null,
    surface_model: 'UNKNOWN',
    canonical_viewport: probe.canonical_viewport ?? null,
    review_depth: probe.review_depth ?? null,
    classification_method: probe.classification_method ?? 'OTHER',
    cluster_taxonomy_version: probe.cluster_taxonomy_version ?? 'UNCLASSIFIED-v0',
    comparison_status: probe.comparison_status ?? 'INCOMPARABLE',
    desktop_item_count: probe.desktop_item_count ?? 0,
    mobile_item_count: probe.mobile_item_count ?? 0,
    mirror_consistent: probe.mirror_consistent ?? null,
    items: (probe.items ?? []).map((item) => sanitizeRecommendationItem(item, seeds)),
  }
}

export function publicTargetFromCapture(capture, seeds) {
  return {
    target_id: capture.target_id,
    service: capture.service,
    page_type: capture.page_type,
    public_id: capture.public_id ?? null,
    discovery_presence: capture.discovery_presence,
    http_status: capture.http_status,
    capture_status: capture.capture_status,
    recommendation_probe: sanitizeRecommendationProbe(capture.recommendation_probe, seeds),
    material_error_count: (capture.material_errors ?? []).length,
  }
}

export function managedIdentityTokens(seeds) {
  const tokens = new Set()
  for (const seed of seeds) {
    if (seed.account_key) tokens.add(seed.account_key.toLowerCase())
    const parsed = normalizeUrl(seed.url)
    if (parsed) {
      tokens.add(parsed.hostname.toLowerCase())
      const compact = parsed.toString().replace(/\/$/, '').toLowerCase()
      tokens.add(compact)
    }
  }
  return [...tokens].filter((token) => token && token !== 'note.com' && token !== 'booth.pm')
}

export function assertNoManagedIdentityLeak(value, seeds) {
  const text = JSON.stringify(value).toLowerCase()
  const leaked = managedIdentityTokens(seeds).filter((token) => text.includes(token))
  if (leaked.length > 0) {
    throw new Error(`managed identity leaked into public output (${leaked.length} token(s))`)
  }
}
