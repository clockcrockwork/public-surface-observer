#!/usr/bin/env node
import { loadSeeds } from './config.mjs'

const command = process.argv[2]

try {
  const registry = loadSeeds()
  if (command === 'validate') {
    console.log(`OK: schema v${registry.schemaVersion}, ${registry.seeds.length} seeds`)
    process.exit(0)
  }
  if (command === 'list') {
    for (const seed of registry.seeds) {
      console.log(`${seed.enabled ? 'ENABLED ' : 'DISABLED'} ${seed.id} ${seed.service} ${seed.url}`)
    }
    process.exit(0)
  }
  throw new Error('usage: node src/seeds-cli.mjs validate|list')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
