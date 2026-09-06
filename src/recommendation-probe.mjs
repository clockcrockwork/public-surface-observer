function itemsFor(viewport) {
  return viewport?.recommendations?.items ?? []
}

function urlsFor(viewport) {
  return itemsFor(viewport).map((item) => item.url)
}

function normalizedCollectionStatus(probe) {
  if (!probe) return 'COLLECTION_FAILED'
  if (probe.collection_status) return probe.collection_status
  return (probe.items?.length ?? 0) > 0 ? 'OK' : 'COLLECTION_FAILED'
}

export function recommendationFailureStage(desktop, mobile) {
  const outcomes = [desktop?.recommendation_settle?.outcome, mobile?.recommendation_settle?.outcome]
  if (outcomes.includes('ROOT_ABSENT')) return 'ROOT_ABSENT'
  if (outcomes.includes('ROOT_WITHOUT_ITEMS')) return 'ROOT_WITHOUT_ITEMS'
  if (outcomes.some((outcome) => outcome === 'POPULATED')) return 'POPULATED_BUT_UNPARSED'
  return 'NOT_OBSERVED'
}

export function buildRecommendationProbe(desktop, mobile) {
  const desktopItems = itemsFor(desktop)
  const mobileItems = itemsFor(mobile)
  const desktopUrls = desktopItems.map((item) => item.url)
  const mobileUrls = mobileItems.map((item) => item.url)
  const desktopCount = desktopItems.length
  const mobileCount = mobileItems.length

  if (desktopCount === 0 && mobileCount === 0) {
    return {
      collection_status: 'COLLECTION_FAILED',
      failure_reason: 'NO_POPULATED_RECOMMENDATION_ITEMS',
      surface_label:
        desktop?.recommendations?.surface_label ?? mobile?.recommendations?.surface_label ?? null,
      surface_model: 'UNKNOWN',
      canonical_viewport: null,
      review_depth: null,
      classification_method: 'OTHER',
      cluster_taxonomy_version: 'UNCLASSIFIED-v0',
      comparison_status: 'INCOMPARABLE',
      desktop_item_count: 0,
      mobile_item_count: 0,
      mirror_consistent: null,
      items: [],
    }
  }

  const canonicalName = desktopCount > 0 ? 'desktop' : 'mobile'
  const canonical = canonicalName === 'desktop' ? desktop : mobile
  return {
    collection_status: desktopCount > 0 && mobileCount > 0 ? 'OK' : 'PARTIAL',
    failure_reason: null,
    surface_label: canonical.recommendations.surface_label,
    surface_model: 'UNKNOWN',
    canonical_viewport: canonicalName,
    review_depth: canonical.recommendations.item_count,
    classification_method: 'OTHER',
    cluster_taxonomy_version: 'UNCLASSIFIED-v0',
    comparison_status: 'COMPARABLE',
    desktop_item_count: desktopCount,
    mobile_item_count: mobileCount,
    mirror_consistent:
      desktopCount > 0 && mobileCount > 0
        ? JSON.stringify(desktopUrls) === JSON.stringify(mobileUrls)
        : null,
    items: canonical.recommendations.items,
  }
}

export function compareRecommendationProbes(beforeProbe, afterProbe) {
  const beforeStatus = normalizedCollectionStatus(beforeProbe)
  const afterStatus = normalizedCollectionStatus(afterProbe)

  if (beforeStatus === 'COLLECTION_FAILED' || afterStatus === 'COLLECTION_FAILED') {
    return {
      comparison_status: 'INCOMPARABLE',
      reason: 'COLLECTION_FAILED',
      retained: [],
      new: [],
      disappeared: [],
    }
  }

  if (
    beforeProbe.review_depth !== afterProbe.review_depth ||
    beforeProbe.classification_method !== afterProbe.classification_method ||
    beforeProbe.cluster_taxonomy_version !== afterProbe.cluster_taxonomy_version ||
    beforeProbe.canonical_viewport !== afterProbe.canonical_viewport
  ) {
    return {
      comparison_status: 'INCOMPARABLE',
      reason: 'OBSERVATION_CONTRACT_MISMATCH',
      retained: [],
      new: [],
      disappeared: [],
    }
  }

  const beforeUrls = (beforeProbe.items ?? []).map((item) => item.url).filter((url) => typeof url === 'string' && url)
  const afterUrls = (afterProbe.items ?? []).map((item) => item.url).filter((url) => typeof url === 'string' && url)
  const beforeSet = new Set(beforeUrls)
  const afterSet = new Set(afterUrls)

  return {
    comparison_status: 'COMPARABLE',
    reason: null,
    retained: afterUrls.filter((url) => beforeSet.has(url)),
    new: afterUrls.filter((url) => !beforeSet.has(url)),
    disappeared: beforeUrls.filter((url) => !afterSet.has(url)),
  }
}

export function recommendationCollectionStatus(probe) {
  return normalizedCollectionStatus(probe)
}

export function recommendationUrls(viewport) {
  return urlsFor(viewport)
}
