// Real wiring test for scripts/provision-opentui-profile.mjs.
//
// The source-text guards elsewhere pin the SHAPE of the script; this file pins
// its BEHAVIOUR: the script is actually spawned against a throwaway DSH_HOME
// with a stub `dsh` first on PATH, and the assertions read the argv the stub
// received, the state file that was written, and the guidance on stderr.
//
// Offline by construction: the stub is a /bin/sh script that logs its argv and
// replays a canned exit status — nothing resolves a registry. Every path lives
// under a fresh mkdtemp and the script's DSH_HOME is always that temp home, so
// the real ~/.dsh is never read or written.
import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectPlugins } from '../scripts/lib/provision-plan.mjs'

const CORE = selectPlugins('core')
const SCRIPT = fileURLToPath(new URL('../scripts/provision-opentui-profile.mjs', import.meta.url))

// The stub host CLI. It is the only `dsh` the script can see (it is first on
// PATH) and every branch is a canned outcome:
//   plugin … add …      → 0, or 1 when DSH_STUB_ADD_FAIL is set; optional
//                         DSH_STUB_ADD_SLEEP (seconds) widens the batch
//   … --dump-config     → one layer header, 0
//   anything else       → 0
const STUB_DHS = `#!/bin/sh
if [ -n "$DSH_STUB_LOG" ]; then
  printf '%s\\n' "$*" >> "$DSH_STUB_LOG"
fi
case "$*" in
  "plugin --profile opentui add"*)
    if [ -n "$DSH_STUB_ADD_SLEEP" ]; then sleep "$DSH_STUB_ADD_SLEEP"; fi
    if [ -n "$DSH_STUB_ADD_FAIL" ]; then
      echo "ERR_PNPM_META_FETCH_FAIL  registry temporarily unavailable" >&2
      exit 1
    fi
    exit 0
    ;;
  *"--dump-config"*)
    echo "# == stub-layer"
    exit 0
    ;;
esac
exit 0
`

interface Fixture {
  root: string
  home: string
  profileDir: string
  statePath: string
  stubDir: string
  argvLogPath: string
}

interface ScriptRun {
  status: number | null
  stdout: string
  stderr: string
  /** One entry per stub invocation, the argv joined with spaces. */
  argv: string[]
  /** Wall clock just before the script was spawned. */
  startedAtMs: number
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-provision-script-'))
  const home = join(root, 'home')
  const stubDir = join(root, 'bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(stubDir, { recursive: true })
  const stubPath = join(stubDir, 'dsh')
  writeFileSync(stubPath, STUB_DHS)
  chmodSync(stubPath, 0o755)
  const argvLogPath = join(root, 'argv.log')
  writeFileSync(argvLogPath, '')
  const profileDir = join(home, 'profiles', 'opentui')
  return { root, home, profileDir, statePath: join(profileDir, '.provision-state.json'), stubDir, argvLogPath }
}

/** The minimal profile the script reuses: a manifest with dependencies and the
 *  bundle list (step 1 never needs `dsh` when the profile dir exists). */
function writeProfile(fixture: Fixture, dependencies: Record<string, string>, bundles: string[]): void {
  mkdirSync(fixture.profileDir, { recursive: true })
  const manifest = {
    name: 'opentui-profile',
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }
  writeFileSync(join(fixture.profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** What `installedVersion()` in the script reads. */
function installPackage(fixture: Fixture, name: string, version: string): void {
  const dir = join(fixture.profileDir, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, version })}\n`)
}

function coreDependencies(omitted: string[] = []): Record<string, string> {
  const deps: Record<string, string> = {}
  for (const plugin of CORE) if (!omitted.includes(plugin.name)) deps[plugin.name] = plugin.version
  return deps
}

function runScript(fixture: Fixture, extraEnv: Record<string, string> = {}): ScriptRun {
  const startedAtMs = Date.now()
  const result = Bun.spawnSync([process.execPath, SCRIPT, '--plugins=core'], {
    env: {
      ...process.env,
      DSH_HOME: fixture.home,
      PATH: `${fixture.stubDir}:${process.env.PATH ?? ''}`,
      DSH_STUB_LOG: fixture.argvLogPath,
      DSH_PROVISION_DRY_RUN: '',
      DSH_OPENTUI_PLUGINS: '',
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const argv = readFileSync(fixture.argvLogPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    argv,
    startedAtMs,
  }
}

const addCalls = (run: ScriptRun) => run.argv.filter((line) => line.startsWith('plugin --profile opentui add'))

describe('provision-opentui-profile.mjs — real wiring', () => {
  test('happy path: one missing dep → exactly one dsh plugin add, exit 0, no state file', () => {
    const fixture = makeFixture()
    try {
      const missing = CORE[0]
      writeProfile(
        fixture,
        coreDependencies([missing.name]),
        CORE.map((plugin) => plugin.name),
      )
      // Every package is on disk at its pin — the add only has to succeed for
      // the readback to confirm it.
      for (const plugin of CORE) installPackage(fixture, plugin.name, plugin.version)

      const run = runScript(fixture)

      expect(run.status).toBe(0)
      expect(run.stdout).toContain('[3/5] plugins')
      expect(run.stdout).toContain('provision-opentui-profile: PASS')
      expect(addCalls(run)).toEqual([
        `plugin --profile opentui add ${missing.name}@${missing.version}`,
      ])
      // A healthy run must not leave failure memory behind.
      expect(existsSync(fixture.statePath)).toBe(false)
      // The clean path keeps the 0.18.0 wording: verified count, then skips.
      expect(run.stdout).toContain(`installed 1, skipped ${CORE.length - 1}`)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  }, 15_000)

  test('degraded: add exits 0 but node_modules keeps another version → degraded line + attempts=1, exit 0', () => {
    const fixture = makeFixture()
    try {
      const target = CORE[0]
      writeProfile(
        fixture,
        coreDependencies(),
        CORE.map((plugin) => plugin.name),
      )
      for (const plugin of CORE) {
        installPackage(fixture, plugin.name, plugin.name === target.name ? '0.6.0' : plugin.version)
      }

      // The stub spends 1s on the install: the failure timestamp must be taken
      // after the batch, so it has to land >= ~1s after the launch.
      const run = runScript(fixture, { DSH_STUB_ADD_SLEEP: '1' })

      expect(run.status).toBe(0)
      expect(run.stderr).toContain('provision-opentui-profile: degraded — 1 plugin(s) not at the pinned version')
      expect(run.stderr).not.toMatch(/^provision: /m)
      // The summary must not claim the failed install next to the degraded line.
      expect(run.stdout).toContain(
        `installed 0 of 1 (${CORE.length - 1} already installed, 1 not at the pinned version)`,
      )
      expect(run.stdout).not.toContain('installed 1, skipped')

      const state = JSON.parse(readFileSync(fixture.statePath, 'utf8'))
      expect(state.failures[target.name].pin).toBe(target.version)
      expect(state.failures[target.name].attempts).toBe(1)
      expect(Date.parse(state.failures[target.name].lastFailedAt) - run.startedAtMs).toBeGreaterThanOrEqual(900)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  }, 15_000)

  test('partial success: the summary counts verified pins, not attempts', () => {
    const fixture = makeFixture()
    try {
      const stale = CORE[0]
      const staleVersion = '0.0.1'
      // Every core plugin is a plan target (the manifest names no dependency),
      // and the batch exits 0; only the readback can tell that one spec did not
      // land at its pin.
      writeProfile(
        fixture,
        {},
        CORE.map((plugin) => plugin.name),
      )
      for (const plugin of CORE) {
        installPackage(fixture, plugin.name, plugin.name === stale.name ? staleVersion : plugin.version)
      }

      const run = runScript(fixture)

      expect(run.status).toBe(0)
      const calls = addCalls(run)
      expect(calls.length).toBe(1)
      for (const plugin of CORE) expect(calls[0]).toContain(`${plugin.name}@${plugin.version}`)
      // 6 of 7 verified; the one at another version is named separately, so the
      // line cannot contradict the degraded line that follows it.
      expect(run.stdout).toContain(`installed ${CORE.length - 1} of ${CORE.length} (1 not at the pinned version)`)
      expect(run.stdout).not.toContain(`installed ${CORE.length}, skipped`)
      expect(run.stderr).toContain('provision-opentui-profile: degraded — 1 plugin(s) not at the pinned version')
      const state = JSON.parse(readFileSync(fixture.statePath, 'utf8'))
      expect(state.failures[stale.name].pin).toBe(stale.version)
      expect(state.failures[stale.name].attempts).toBe(1)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  }, 15_000)

  test('circuit breaker: a pin at the attempt cap never reaches dsh plugin add, skip line carries the rm hint', () => {
    const fixture = makeFixture()
    try {
      writeProfile(fixture, {}, [])
      const failedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const failures: Record<string, unknown> = {}
      for (const plugin of CORE) {
        failures[plugin.name] = {
          pin: plugin.version,
          attempts: 3,
          firstFailedAt: failedAt,
          lastFailedAt: failedAt,
          error: 'ERR_PNPM_META_FETCH_FAIL',
        }
      }
      writeFileSync(fixture.statePath, `${JSON.stringify({ version: 1, failures }, null, 2)}\n`)

      const run = runScript(fixture)

      expect(run.status).toBe(0)
      expect(run.stderr).toContain(
        `provision-opentui-profile: skipping ${CORE.length} package(s) after repeated failures:`,
      )
      expect(run.stderr).toContain(`rm ${fixture.statePath}`)
      expect(run.stderr).not.toMatch(/^provision: /m)
      // No install was attempted: the only stub calls are the dump-config ones.
      expect(addCalls(run)).toEqual([])
      expect(run.argv.every((line) => !line.includes('plugin'))).toBe(true)

      // The memory is kept as-is (nothing new failed, so nothing is rewritten).
      const state = JSON.parse(readFileSync(fixture.statePath, 'utf8'))
      expect(state.failures[CORE[0].name].attempts).toBe(3)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  }, 15_000)
})
