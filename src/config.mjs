import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import YAML from 'yaml'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_CONFIG = resolve(REPO_ROOT, 'config/seeds.yaml')
const ALLOWED_SERVICES = new Set(['note', 'booth'])

function ensureBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`)
  return value
}

function validateSeed(seed, index) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) {
    throw new Error(`seeds[${index}] must be an object`)
  }
  const id = String(seed.id ?? '').trim()
  const service = String(seed.service ?? '').trim()
  const accountKey = String(seed.account_key ?? '').trim()
  const rawUrl = String(seed.url ?? '').trim()
  if (!id || !/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error(`seeds[${index}].id is invalid`)
  if (!ALLOWED_SERVICES.has(service)) throw new Error(`seeds[${index}].service must be note|booth`)
  if (!accountKey) throw new Error(`seeds[${index}].account_key is required`)
  if (!rawUrl) throw new Error(`seeds[${index}].url is required`)

  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error(`seeds[${index}].url must use https`)
  if (service === 'note' && url.hostname !== 'note.com') {
    throw new Error(`seeds[${index}].url is not a note.com URL`)
  }
  if (service === 'booth' && !(url.hostname === 'booth.pm' || url.hostname.endsWith('.booth.pm'))) {
    throw new Error(`seeds[${index}].url is not a BOOTH URL`)
  }

  return {
    id,
    service,
    account_key: accountKey,
    url: url.toString(),
    enabled: ensureBoolean(seed.enabled, `seeds[${index}].enabled`),
    discover_children: ensureBoolean(seed.discover_children, `seeds[${index}].discover_children`),
  }
}

export function parseSeedRegistry(text) {
  const parsed = YAML.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('seed registry must be a YAML object')
  if (parsed.schema_version !== 1) throw new Error('schema_version must be 1')
  if (!Array.isArray(parsed.seeds)) throw new Error('seeds must be an array')
  const seeds = parsed.seeds.map(validateSeed)
  const ids = new Set()
  for (const seed of seeds) {
    if (ids.has(seed.id)) throw new Error(`duplicate seed id: ${seed.id}`)
    ids.add(seed.id)
  }
  return { schemaVersion: 1, seeds }
}

export function loadSeeds() {
  const runtime = process.env.OBSERVER_SEEDS_YAML
  const text = runtime?.trim() ? runtime : readFileSync(DEFAULT_CONFIG, 'utf8')
  return parseSeedRegistry(text)
}

export function validateOneOffUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error('one-off URL must use https')
  if (url.hostname === 'note.com') return { service: 'note', url: url.toString() }
  if (url.hostname === 'booth.pm' || url.hostname.endsWith('.booth.pm')) {
    return { service: 'booth', url: url.toString() }
  }
  throw new Error('one-off URL must be on note.com or booth.pm')
}
