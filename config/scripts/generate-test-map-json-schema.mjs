// Why: the zod schema is the single source of truth for the test map format; the published
// JSON Schema is derived from it so editors and agents never see a drifted copy.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import * as esbuild from 'esbuild'
import { resolveOxcCliInvocation } from './oxc-cli-invocation.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SCHEMA_SOURCE = path.join(
  REPO_ROOT,
  'src',
  'shared',
  'test-orchestrator',
  'test-map-schema.ts'
)
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'reference', 'orca-test-map.schema.json')

// Why under out/: the bundle keeps node_modules external and oxfmt resolves its config by walking up.
function scratchDir(prefix) {
  const root = path.join(REPO_ROOT, 'out')
  mkdirSync(root, { recursive: true })
  return mkdtempSync(path.join(root, prefix))
}

function render() {
  const buildDir = scratchDir('test-map-json-schema-')
  try {
    const outfile = path.join(buildDir, 'bundle.cjs')
    esbuild.buildSync({
      entryPoints: [SCHEMA_SOURCE],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      logLevel: 'error',
      packages: 'external'
    })
    const require = createRequire(import.meta.url)
    const { TestMapFileSchema } = require(outfile)
    const { z } = require('zod')
    // Why io 'input': defaults and the generated query id are load-time fills, not author requirements.
    const schema = z.toJSONSchema(TestMapFileSchema, { io: 'input', unrepresentable: 'any' })
    const file = path.join(buildDir, 'orca-test-map.schema.json')
    writeFileSync(
      file,
      `${JSON.stringify({ ...schema, title: 'Orca test map (orcaTestMap: 1)' }, null, 2)}\n`
    )
    const { command, prefixArgs } = resolveOxcCliInvocation('oxfmt', 'oxfmt', REPO_ROOT)
    execFileSync(command, [...prefixArgs, '--write', file], { stdio: 'ignore', windowsHide: true })
    return readFileSync(file, 'utf8')
  } finally {
    rmSync(buildDir, { recursive: true, force: true })
  }
}

function main() {
  const check = process.argv.includes('--check')
  const generated = render()
  const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : null
  if (generated === current) {
    return
  }
  if (check) {
    console.error(
      'docs/reference/orca-test-map.schema.json is out of date. Run `pnpm run generate:test-map-json-schema`.'
    )
    process.exitCode = 1
    return
  }
  writeFileSync(OUTPUT_PATH, generated)
  console.log('wrote docs/reference/orca-test-map.schema.json')
}

main()
