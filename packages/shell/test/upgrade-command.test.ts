// `dsh-opentui upgrade` — every npm call is an injected executor, so these
// tests never touch a registry and never install anything. The bin-level cases
// only exercise the pre-npm usage/help paths as real processes.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  captureGlobalPrefix,
  compareVersions,
  displayRegistry,
  findLinkedGlobalInstall,
  formatUpgradeUsage,
  globalPackagePaths,
  isGlobalInstall,
  npmInstallCommand,
  npmViewArgs,
  PACKAGE_NAME,
  parseUpgradeArgs,
  planUpgrade,
  resolveTargetVersion,
  runUpgrade,
  verifyInstalledVersion,
} from '../scripts/upgrade.mjs'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const binPath = join(pkgRoot, 'bin', 'dsh-opentui.mjs')
const CURRENT = '0.18.3'
const TARGET = '0.19.0'
const BETA = '0.20.0-beta.1'
const PREFIX = '/opt/fake-global'
const GLOBAL_ROOT = join(PREFIX, 'lib', 'node_modules', PACKAGE_NAME)
const SOURCE_ROOT = '/src/dsh-opentui'

type Result = { status: number; stdout?: string; stderr?: string; error?: Error }
type Call = { cmd: string; args: string[]; opts?: Record<string, unknown> }

function harness(opts: {
  runningRoot?: string
  prefix?: string
  tags?: Record<string, string>
  viewStatus?: number
  viewError?: Error
  prefixStatus?: number
  prefixError?: Error
  prefixStdout?: string
  installStatus?: number
  installStdout?: string
  installStderr?: string
  installedVersion?: string
  env?: Record<string, string>
} = {}) {
  const runningRoot = opts.runningRoot ?? GLOBAL_ROOT
  const prefix = opts.prefix ?? PREFIX
  const tags = opts.tags ?? { latest: TARGET, beta: BETA }
  const calls: Call[] = []
  const outLines: string[] = []
  const errLines: string[] = []
  const readVersionCalls: string[] = []
  let installed = false
  let installedSpec: string | undefined

  const exec = (cmd: string, args: string[], execOpts?: Record<string, unknown>): Result => {
    calls.push({ cmd, args, opts: execOpts })
    if (cmd !== 'npm') throw new Error(`unexpected command: ${cmd}`)
    switch (args[0]) {
      case 'view':
        if (opts.viewError) return { status: 1, stdout: '', error: opts.viewError }
        if ((opts.viewStatus ?? 0) !== 0) return { status: opts.viewStatus ?? 1, stdout: '' }
        return { status: 0, stdout: JSON.stringify(tags) }
      case 'prefix':
        if (opts.prefixError) return { status: 1, stdout: '', error: opts.prefixError }
        if ((opts.prefixStatus ?? 0) !== 0) return { status: opts.prefixStatus ?? 1, stdout: '' }
        return { status: 0, stdout: `${opts.prefixStdout ?? prefix}\n` }
      case 'i':
        installed = true
        installedSpec = args[2]?.slice(PACKAGE_NAME.length + 1)
        return { status: opts.installStatus ?? 0, stdout: opts.installStdout ?? '', stderr: opts.installStderr ?? '' }
      default:
        throw new Error(`unexpected npm command: ${args[0]}`)
    }
  }

  const readVersion = (dir: string) => {
    readVersionCalls.push(dir)
    const after = opts.installedVersion ?? installedSpec ?? TARGET
    if (dir === runningRoot) return installed ? after : CURRENT
    // Tighten the old mock: only a path under the GLOBAL PREFIX may report the
    // installed version. A wrong implementation that re-reads pkgRoot (or any
    // arbitrary dir) now fails the post-install verification.
    if (installed && globalPackagePaths(prefix).includes(dir)) return after
    return undefined
  }

  const ctx = {
    env: opts.env ?? {},
    exec,
    pkgRoot: runningRoot,
    readVersion,
    out: (line: string) => outLines.push(line),
    err: (line: string) => errLines.push(line),
  }
  return { ctx, calls, outLines, errLines, readVersionCalls, get installed() { return installed } }
}

function installCall(calls: Call[]) {
  return calls.find((call) => call.cmd === 'npm' && call.args[0] === 'i')
}

function viewCall(calls: Call[]) {
  return calls.find((call) => call.cmd === 'npm' && call.args[0] === 'view')
}

// --- pure helpers -----------------------------------------------------------

describe('pure upgrade helpers', () => {
  test('compareVersions is exported and orders target vs current', () => {
    expect(compareVersions(TARGET, CURRENT)).toBe(1)
    expect(compareVersions(CURRENT, CURRENT)).toBe(0)
    expect(compareVersions(CURRENT, TARGET)).toBe(-1)
    expect(compareVersions('0.20.0-beta.1', '0.20.0')).toBe(-1)
  })

  test('npm command builders keep one package name and one registry source', () => {
    expect(npmViewArgs({})).toEqual(['view', PACKAGE_NAME, 'dist-tags', '--json'])
    expect(npmViewArgs({ registry: 'https://r.test/' })).toEqual([
      'view', PACKAGE_NAME, 'dist-tags', '--json', '--registry', 'https://r.test/',
    ])
    expect(npmInstallCommand({ targetVersion: TARGET })).toEqual(['npm', 'i', '-g', `${PACKAGE_NAME}@${TARGET}`])
    expect(npmInstallCommand({ targetVersion: TARGET, registry: 'https://r.test/' })).toEqual([
      'npm', 'i', '-g', `${PACKAGE_NAME}@${TARGET}`, '--registry', 'https://r.test/',
    ])
  })

  test('isGlobalInstall accepts the global package dir, rejects a source tree', () => {
    // Injected values only: no exec happens here.
    expect(isGlobalInstall({ globalPrefix: PREFIX, runningRoot: GLOBAL_ROOT })).toBe(true)
    expect(isGlobalInstall({ globalPrefix: PREFIX, runningRoot: SOURCE_ROOT })).toBe(false)
  })

  test('planUpgrade covers install / up-to-date / downgrade / not-global / dry-run', () => {
    expect(planUpgrade({ targetVersion: TARGET, currentVersion: CURRENT, isGlobal: true }).action).toBe('install')
    expect(planUpgrade({ targetVersion: CURRENT, currentVersion: CURRENT }).action).toBe('up-to-date')
    expect(planUpgrade({ targetVersion: CURRENT, currentVersion: TARGET, isGlobal: true }).action).toBe('downgrade')
    expect(planUpgrade({ targetVersion: TARGET, currentVersion: CURRENT }).action).toBe('not-global')
    expect(planUpgrade({ targetVersion: TARGET, currentVersion: CURRENT, dryRun: true }).action).toBe('dry-run')
    expect(planUpgrade({ targetVersion: TARGET, currentVersion: CURRENT, dryRun: true }).command).toEqual(
      npmInstallCommand({ targetVersion: TARGET }),
    )
  })

  test('parseUpgradeArgs takes --tag / --tag= / --dry-run and rejects bad argv', () => {
    expect(parseUpgradeArgs([])).toMatchObject({ tag: 'latest', dryRun: false, error: null })
    expect(parseUpgradeArgs(['--tag', 'beta', '--dry-run'])).toMatchObject({ tag: 'beta', dryRun: true, error: null })
    expect(parseUpgradeArgs(['--tag=beta'])).toMatchObject({ tag: 'beta', error: null })
    expect(parseUpgradeArgs(['--tag']).error).toBe('missing-value')
    expect(parseUpgradeArgs(['--tag', '--dry-run']).error).toBe('missing-value')
    expect(parseUpgradeArgs(['extra']).error).toBe('unknown')
    expect(formatUpgradeUsage()).toContain('upgrade [--tag <dist-tag>] [--dry-run]')
  })

  test('duplicate --tag is a usage error carrying BOTH values', () => {
    expect(parseUpgradeArgs(['--tag', 'beta', '--tag', 'next'])).toMatchObject({
      error: 'duplicate-tag', errorPrevious: 'beta', errorValue: 'next',
    })
    expect(parseUpgradeArgs(['--tag=beta', '--tag=next'])).toMatchObject({
      error: 'duplicate-tag', errorPrevious: 'beta', errorValue: 'next',
    })
  })

  test('--tag rejects injection characters and whitespace', () => {
    for (const value of ['a b', 'a\tb', 'a\nb', 'a;rm -rf /', '../x', 'https://evil.test', 'a=b', 'a&b']) {
      expect(parseUpgradeArgs(['--tag', value])).toMatchObject({ error: 'invalid-tag', errorValue: value })
      expect(parseUpgradeArgs([`--tag=${value}`])).toMatchObject({ error: 'invalid-tag', errorValue: value })
    }
    expect(formatUpgradeUsage()).toContain('letters/digits first')
  })

  test('displayRegistry strips embedded credentials and never echoes garbage', () => {
    expect(displayRegistry('https://user:token@registry.example.test/path')).toBe('https://registry.example.test/path')
    expect(displayRegistry('http://u:p@host:8080/')).toBe('http://host:8080/')
    expect(displayRegistry('https://registry.example.test/')).toBe('https://registry.example.test/')
    expect(displayRegistry('alice:s3cr3t@host')).toBe('<invalid registry>')
    expect(displayRegistry('ftp://alice:s3cr3t@host/')).toBe('<invalid registry>')
    expect(displayRegistry('not a url')).toBe('<invalid registry>')
    expect(displayRegistry(undefined as unknown as string)).toBe('<invalid registry>')
  })

  test('captureGlobalPrefix: undefined on failure unless strict, then it throws', () => {
    const failing = () => ({ status: 1, stdout: '' })
    expect(captureGlobalPrefix(failing)).toBeUndefined()
    expect(() => captureGlobalPrefix(failing, { strict: true })).toThrow(/无法确定 npm 全局前缀/)
    const throwing = () => { throw new Error('ENOENT') }
    expect(() => captureGlobalPrefix(throwing, { strict: true })).toThrow(/ENOENT/)
    expect(captureGlobalPrefix(() => ({ status: 0, stdout: `${PREFIX}\n` }))).toBe(PREFIX)
  })

  test('resolveTargetVersion reports malformed JSON / missing tag / non-exact semver', () => {
    const execWith = (stdout: string) => () => ({ status: 0, stdout })
    expect(() => resolveTargetVersion({ tag: 'beta', exec: execWith('{not json') })).toThrow(/不是合法 JSON/)
    expect(() => resolveTargetVersion({ tag: 'beta', exec: execWith(JSON.stringify({ latest: TARGET })) })).toThrow(/没有 'beta' dist-tag/)
    expect(() => resolveTargetVersion({ tag: 'beta', exec: execWith(JSON.stringify({ beta: '^0.20.0' })) })).toThrow(/不是精确 semver/)
    expect(() => resolveTargetVersion({ tag: 'beta', exec: execWith(JSON.stringify({ beta: '' })) })).toThrow(/没有 'beta' dist-tag/)
    expect(resolveTargetVersion({ tag: 'beta', exec: execWith(JSON.stringify({ beta: `v${BETA}` })) })).toBe(BETA)
  })

  test('verifyInstalledVersion reads package.json under the global prefix, not pkgRoot', () => {
    const seen: string[] = []
    const exec = () => ({ status: 0, stdout: `${PREFIX}\n` })
    const ok = verifyInstalledVersion({
      targetVersion: TARGET,
      exec,
      readVersion: (dir: string) => {
        seen.push(dir)
        return globalPackagePaths(PREFIX).includes(dir) ? TARGET : '0.0.0'
      },
    })
    expect(ok.ok).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((dir) => dir.startsWith(PREFIX))).toBe(true)
    expect(seen).not.toContain(SOURCE_ROOT)

    // The inverse proves the check is real: a version found ONLY at pkgRoot
    // does not count as a successful install.
    const bad = verifyInstalledVersion({
      targetVersion: TARGET,
      exec,
      readVersion: (dir: string) => (dir === SOURCE_ROOT ? TARGET : '0.0.0'),
    })
    expect(bad.ok).toBe(false)
  })

  test('findLinkedGlobalInstall detects an npm link symlink under the prefix', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-upgrade-link-'))
    try {
      const prefix = join(root, 'prefix')
      const pkgDir = join(prefix, 'lib', 'node_modules', PACKAGE_NAME)
      mkdirSync(dirname(pkgDir), { recursive: true })
      symlinkSync(join(root, 'source'), pkgDir, 'dir')
      expect(findLinkedGlobalInstall(prefix)).toBe(pkgDir)
      expect(findLinkedGlobalInstall(join(root, 'empty-prefix'))).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// --- runUpgrade branches ---------------------------------------------------

describe('runUpgrade: target newer than current', () => {
  test('captures npm install stdio, redacts it, then verifies and exits 0', async () => {
    const h = harness()
    const code = await runUpgrade([], h.ctx)
    expect(code).toBe(0)
    expect(viewCall(h.calls)?.args).toEqual(['view', PACKAGE_NAME, 'dist-tags', '--json'])
    expect(installCall(h.calls)?.args).toEqual(['i', '-g', `${PACKAGE_NAME}@${TARGET}`])
    expect(installCall(h.calls)?.opts).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
    // view -> prefix (precheck) -> install -> prefix (verify); no companions/provision.
    expect(h.calls.filter((c) => c.args[0] === 'prefix')).toHaveLength(2)
    expect(h.outLines.join('\n')).toContain('升级完成，退出并重新运行')
    expect(h.errLines).toEqual([])
  })

  test('the same --registry override is appended to view and install', async () => {
    const registry = 'https://registry.example.test/'
    const h = harness({ env: { DSH_UPGRADE_REGISTRY: registry } })
    const code = await runUpgrade([], h.ctx)
    expect(code).toBe(0)
    expect(viewCall(h.calls)?.args).toEqual(['view', PACKAGE_NAME, 'dist-tags', '--json', '--registry', registry])
    expect(installCall(h.calls)?.args).toEqual(['i', '-g', `${PACKAGE_NAME}@${TARGET}`, '--registry', registry])
  })

  test('a failing install exits 1 and does not claim success', async () => {
    const h = harness({ installStatus: 1 })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    expect(h.outLines.join('\n')).not.toContain('升级完成')
    expect(h.errLines.join('\n')).toContain('npm 安装失败')
  })

  test('a post-install version mismatch exits 1', async () => {
    const h = harness({ installedVersion: '0.0.0' })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    expect(h.errLines.join('\n')).toContain('安装后校验失败')
  })
})

describe('runUpgrade: no install branches', () => {
  test('target equals current: already up to date, no install and no prefix lookup', async () => {
    const h = harness({ tags: { latest: CURRENT } })
    expect(await runUpgrade([], h.ctx)).toBe(0)
    expect(h.outLines.join('\n')).toContain('already up to date')
    expect(installCall(h.calls)).toBeUndefined()
    expect(h.calls.some((c) => c.args[0] === 'prefix')).toBe(false)
  })

  test('target older than current: refusing to downgrade, exit 1, no install', async () => {
    const h = harness({ tags: { latest: '0.17.9' } })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    expect(h.errLines.join('\n')).toContain('refusing to downgrade')
    expect(installCall(h.calls)).toBeUndefined()
    expect(h.installed).toBe(false)
  })

  test('non-global install: exit 1 with the manual npm command, no install', async () => {
    const h = harness({ runningRoot: SOURCE_ROOT })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    expect(h.errLines.join('\n')).toContain('当前不是 npm 全局安装，请手动执行 npm i -g')
    expect(h.errLines.join('\n')).toContain(`${PACKAGE_NAME}@${TARGET}`)
    expect(installCall(h.calls)).toBeUndefined()
    expect(h.installed).toBe(false)
  })

  test('registry query failure: exit 1 with the registry URL, no install', async () => {
    const registry = 'https://registry.example.test/'
    const h = harness({ env: { DSH_UPGRADE_REGISTRY: registry }, viewStatus: 1 })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    expect(h.errLines.join('\n')).toContain(registry)
    expect(viewCall(h.calls)?.args).toContain(registry)
    expect(installCall(h.calls)).toBeUndefined()
  })

  test('a thrown registry query names npm\'s OWN configured registry, not a hardcoded public URL', async () => {
    const h = harness({ viewError: new Error('network down') })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    expect(h.errLines.join('\n')).toContain('npm 自身配置的 registry')
    expect(h.errLines.join('\n')).not.toContain('registry.npmjs.org')
    expect(installCall(h.calls)).toBeUndefined()
  })

  test('--dry-run resolves and prints the command but never installs', async () => {
    const h = harness({ runningRoot: SOURCE_ROOT })
    expect(await runUpgrade(['--dry-run'], h.ctx)).toBe(0)
    expect(viewCall(h.calls)).toBeDefined()
    expect(installCall(h.calls)).toBeUndefined()
    expect(h.calls.some((c) => c.args[0] === 'prefix')).toBe(false)
    expect(h.outLines.join('\n')).toContain(`npm i -g ${PACKAGE_NAME}@${TARGET}`)
    expect(h.outLines.join('\n')).toContain('--dry-run')
  })

  test('--tag beta resolves the beta dist-tag and installs that version', async () => {
    const h = harness()
    expect(await runUpgrade(['--tag', 'beta'], h.ctx)).toBe(0)
    expect(viewCall(h.calls)?.args).toEqual(['view', PACKAGE_NAME, 'dist-tags', '--json'])
    expect(installCall(h.calls)?.args).toEqual(['i', '-g', `${PACKAGE_NAME}@${BETA}`])
    expect(h.outLines.join('\n')).toContain('beta')
  })

  test('--tag=beta (inline form) resolves the same dist-tag', async () => {
    const h = harness()
    expect(await runUpgrade(['--tag=beta'], h.ctx)).toBe(0)
    expect(installCall(h.calls)?.args).toEqual(['i', '-g', `${PACKAGE_NAME}@${BETA}`])
  })

  test('the --tag value is a JSON key only and never enters npm view argv', async () => {
    for (const tag of ['beta', 'next', 'canary']) {
      const h = harness({ tags: { latest: TARGET, beta: BETA, next: BETA, canary: BETA } })
      expect(await runUpgrade(['--tag', tag], h.ctx)).toBe(0)
      const argv = viewCall(h.calls)!.args.join(' ')
      expect(argv).not.toContain(tag)
      expect(argv).toBe(`view ${PACKAGE_NAME} dist-tags --json`)
    }
  })

  test('invalid --tag and duplicate --tag are usage errors (exit 2) with the offending values', async () => {
    const h = harness()
    expect(await runUpgrade(['--tag', 'bad tag'], h.ctx)).toBe(2)
    expect(h.errLines.join('\n')).toContain('bad tag')
    expect(h.errLines.join('\n')).toContain('字母、数字')
    expect(viewCall(h.calls)).toBeUndefined()

    const h2 = harness()
    expect(await runUpgrade(['--tag', 'beta', '--tag', 'next'], h2.ctx)).toBe(2)
    expect(h2.errLines.join('\n')).toContain('beta')
    expect(h2.errLines.join('\n')).toContain('next')
    expect(viewCall(h2.calls)).toBeUndefined()
  })

  test('invalid DSH_UPGRADE_REGISTRY values fail loudly and never echo credentials or call npm', async () => {
    for (const value of [
      'registry.example.test',
      'ftp://registry.example.test/',
      'alice:s3cr3t@host',
      'ftp:alice:s3cr3t@host',
    ]) {
      const h = harness({ env: { DSH_UPGRADE_REGISTRY: value } })
      expect(await runUpgrade([], h.ctx)).toBe(1)
      expect(h.errLines.join('\n')).toContain('必须以 http:// 或 https:// 开头')
      expect(h.errLines.join('\n')).not.toContain('alice')
      expect(h.errLines.join('\n')).not.toContain('s3cr3t')
      expect(h.calls).toEqual([])
    }
    // Blank is treated as unset: npm's own configured registry is used.
    const blank = harness({ env: { DSH_UPGRADE_REGISTRY: '  ' } })
    expect(await runUpgrade([], blank.ctx)).toBe(0)
    expect(viewCall(blank.calls)?.args).toEqual(['view', PACKAGE_NAME, 'dist-tags', '--json'])
  })

  test('a failed prefix query exits 1 and NEVER installs, with a prefix-specific error', async () => {
    for (const opts of [
      { prefixError: new Error('ENOENT') },
      { prefixStatus: 1 },
      { prefixStdout: '  \n' },
    ]) {
      const h = harness(opts)
      expect(await runUpgrade([], h.ctx)).toBe(1)
      expect(h.errLines.join('\n')).toContain('npm 全局前缀')
      expect(installCall(h.calls)).toBeUndefined()
      expect(h.installed).toBe(false)
    }
  })

  test('an npm link symlink under the global prefix is rejected before install', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-upgrade-run-link-'))
    try {
      const source = join(root, 'source')
      mkdirSync(source, { recursive: true })
      const prefix = join(root, 'prefix')
      const linked = join(prefix, 'lib', 'node_modules', PACKAGE_NAME)
      mkdirSync(dirname(linked), { recursive: true })
      symlinkSync(source, linked, 'dir')
      const h = harness({ prefix, runningRoot: source })
      expect(await runUpgrade([], h.ctx)).toBe(1)
      expect(h.errLines.join('\n')).toContain('npm link')
      expect(installCall(h.calls)).toBeUndefined()
      expect(h.installed).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('missing current version aborts before any install', async () => {
    const h = harness()
    const code = await runUpgrade([], {
      ...h.ctx,
      readVersion: (dir: string) => (dir === GLOBAL_ROOT ? undefined : CURRENT),
    })
    expect(code).toBe(1)
    expect(installCall(h.calls)).toBeUndefined()
  })
})

// --- P1: registry credentials must never reach output ----------------------

describe('registry credential redaction', () => {
  const SECRET_REGISTRY = 'https://alice:s3cr3t@registry.example.test/'
  const SCRUBBED = 'https://registry.example.test/'

  test('an npm error that itself quotes a credential URL is redacted too', async () => {
    const h = harness({ viewError: new Error(`request to ${SECRET_REGISTRY} failed`) })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    const stderr = h.errLines.join('\n')
    expect(stderr).toContain('registry.example.test')
    expect(stderr).not.toContain('s3cr3t')
    expect(stderr).not.toContain('alice')
  })

  test('a registry query failure prints the host but never the token', async () => {
    const h = harness({ env: { DSH_UPGRADE_REGISTRY: SECRET_REGISTRY }, viewStatus: 1 })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    const stderr = h.errLines.join('\n')
    expect(stderr).toContain('registry.example.test')
    expect(stderr).not.toContain('s3cr3t')
    expect(stderr).not.toContain('alice')
    // argv still receives the ORIGINAL value — redaction is display-only.
    expect(viewCall(h.calls)?.args).toContain(SECRET_REGISTRY)
  })

  test('--dry-run prints a redacted command while npm would get the real one', async () => {
    const h = harness({ env: { DSH_UPGRADE_REGISTRY: SECRET_REGISTRY }, runningRoot: SOURCE_ROOT })
    expect(await runUpgrade(['--dry-run'], h.ctx)).toBe(0)
    const stdout = h.outLines.join('\n')
    expect(stdout).toContain(`--registry ${SCRUBBED}`)
    expect(stdout).not.toContain('s3cr3t')
    expect(stdout).not.toContain('alice')
    expect(installCall(h.calls)).toBeUndefined()
    // dry-run still sends the original registry to `npm view`.
    expect(viewCall(h.calls)?.args).toContain(SECRET_REGISTRY)
  })

  test('the not-global manual instruction is redacted', async () => {
    const h = harness({ env: { DSH_UPGRADE_REGISTRY: SECRET_REGISTRY }, runningRoot: SOURCE_ROOT })
    expect(await runUpgrade([], h.ctx)).toBe(1)
    const stderr = h.errLines.join('\n')
    expect(stderr).toContain(SCRUBBED)
    expect(stderr).not.toContain('s3cr3t')
    expect(stderr).not.toContain('alice')
  })

  test('captured npm install stdout and stderr are replayed through the redactor', async () => {
    const h = harness({
      env: { DSH_UPGRADE_REGISTRY: SECRET_REGISTRY },
      installStdout: `install output: ${SECRET_REGISTRY}\n`,
      installStderr: `install warning: ${SECRET_REGISTRY}\n`,
    })
    expect(await runUpgrade([], h.ctx)).toBe(0)
    expect(h.outLines.join('\n')).toContain(`install output: ${SCRUBBED}`)
    expect(h.errLines.join('\n')).toContain(`install warning: ${SCRUBBED}`)
    expect(h.outLines.join('\n')).not.toContain('alice')
    expect(h.outLines.join('\n')).not.toContain('s3cr3t')
    expect(h.errLines.join('\n')).not.toContain('alice')
    expect(h.errLines.join('\n')).not.toContain('s3cr3t')
    expect(installCall(h.calls)?.args).toContain(SECRET_REGISTRY)
  })

  test('the install command echoed to stdout is redacted but exec argv is not', async () => {
    const h = harness({ env: { DSH_UPGRADE_REGISTRY: SECRET_REGISTRY } })
    expect(await runUpgrade([], h.ctx)).toBe(0)
    expect(h.outLines.join('\n')).toContain(`--registry ${SCRUBBED}`)
    expect(h.outLines.join('\n')).not.toContain('s3cr3t')
    expect(installCall(h.calls)?.args).toContain(SECRET_REGISTRY)
  })
})

// --- bin-level usage paths (no registry access) ----------------------------

describe('bin integration: upgrade help and usage errors', () => {
  test('upgrade --help and -h show the SUBCOMMAND help, not the main help, exit 0', () => {
    for (const flag of ['--help', '-h']) {
      const r = spawnSync('node', [binPath, 'upgrade', flag], { encoding: 'utf8', timeout: 30_000 })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage: dsh-opentui upgrade')
      expect(r.stdout).toContain('upgrade [--tag <dist-tag>] [--dry-run]')
      expect(r.stdout).toContain('--tag')
      expect(r.stdout).toContain('--dry-run')
      expect(r.stdout).not.toContain('Usage: dsh-opentui [options]')
      expect(r.stderr).toBe('')
    }
  })

  test('launcher-only flags after upgrade are NOT swallowed: each is an exit-2 usage error', () => {
    for (const flag of ['--version', '-v', '--force', '--yes', '--repair-bridge']) {
      const r = spawnSync('node', [binPath, 'upgrade', flag], { encoding: 'utf8', timeout: 30_000 })
      expect(r.status).toBe(2)
      expect(r.stdout).toBe('')
      expect(r.stderr).toContain(`unknown argument '${flag}'`)
      expect(r.stderr).toContain('Usage: dsh-opentui upgrade')
      expect(r.stderr).not.toContain('dsh-opentui 0.') // no version short-circuit
      expect(r.stderr).not.toContain('deprecated') // no launcher flag warning
    }
  })

  test('an unknown upgrade argument is a usage error, exit 2', () => {
    const r = spawnSync('node', [binPath, 'upgrade', '--bogus'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain("unknown argument '--bogus'")
    expect(r.stderr).toContain('Usage: dsh-opentui upgrade')
  })

  test('a missing --tag value is a usage error, exit 2', () => {
    const r = spawnSync('node', [binPath, 'upgrade', '--tag'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("option '--tag' requires a value")
  })
})
