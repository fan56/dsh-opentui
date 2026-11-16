// The `upgrade` execution skeleton, driven entirely through injected effects:
// a fake `run` (never a real npm) and an in-memory `fs` (never a real profile).
// This is how the install / verify / abort paths are covered without a network,
// a TTY, or a globally installed copy of this package.
import { describe, expect, test } from 'bun:test'
import { OFFICIAL_REGISTRY } from '../scripts/lib/upgrade-plan.mjs'
import { runUpgrade } from '../scripts/upgrade.mjs'

const ROOT = '/fixture/pkg'
const HOME = '/fixture/home'
const DSH_HOME = `${HOME}/.dsh`
const PROFILE_DIR = `${DSH_HOME}/profiles/opentui`
const MANIFEST = `${PROFILE_DIR}/package.json`
const OVERRIDE = `${PROFILE_DIR}/upgrade-overrides.json`
const SELF_MANIFEST = `${ROOT}/package.json`
const PREFIX = '/fixture/prefix'
const SELF_NAME = '@aiwayds/dsh-opentui'
const GLOBAL_DIR = `${PREFIX}/lib/node_modules/${SELF_NAME}`
const GLOBAL_MANIFEST = `${GLOBAL_DIR}/package.json`
const SELF_PATH_GLOBAL = `${GLOBAL_DIR}/scripts/upgrade.mjs`
const SELF_PATH_FOREIGN = `${ROOT}/scripts/upgrade.mjs`
const PLUGIN = '@aiwayds/dsh-plugin-a'

const ENV = { HOME, DSH_HOME }

type RunResult = { status: number; stdout: string; stderr: string }
type RunCall = { cmd: string; args: string[]; timeout?: number }

const selfManifest = (version: string) => JSON.stringify({ name: SELF_NAME, version })

const profileManifest = (dependencies: Record<string, string> = {}) =>
  JSON.stringify({ name: 'opentui-profile', dependencies })

const installedPlugin = (version: string) =>
  JSON.stringify({ name: PLUGIN, version })

/** In-memory fs: missing paths behave like ENOENT, and every mutation is
 *  recorded so a test can assert "the profile was not touched". The fd trio
 *  backs the exclusive-create profile lock (.upgrade.lock). */
function fakeFs(files: Record<string, string>) {
  const state = {
    files: new Map(Object.entries(files)),
    written: [] as string[],
    removed: [] as string[],
    made: [] as string[],
    copied: [] as Array<[string, string]>,
    opened: [] as Array<{ path: string; flags: string }>,
  }
  const fds = new Map<number, string>()
  let nextFd = 1
  const fs = {
    readFileSync: (path: string) => {
      const text = state.files.get(path)
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      return text
    },
    writeFileSync: (path: string, data: string) => {
      state.written.push(path)
      state.files.set(path, String(data))
    },
    existsSync: (path: string) => {
      if (state.files.has(path)) return true
      const prefix = path.endsWith('/') ? path : `${path}/`
      for (const key of state.files.keys()) if (key.startsWith(prefix)) return true
      return false
    },
    mkdirSync: (path: string) => {
      state.made.push(path)
    },
    rmSync: (path: string) => {
      state.removed.push(path)
      state.files.delete(path)
    },
    rmdirSync: (path: string) => {
      state.removed.push(path)
      state.files.delete(path)
    },
    copyFileSync: (from: string, to: string) => {
      state.copied.push([from, to])
    },
    openSync: (path: string, flags: string) => {
      state.opened.push({ path, flags })
      if (flags === 'wx' && state.files.has(path)) {
        throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' })
      }
      const fd = nextFd
      nextFd += 1
      fds.set(fd, path)
      return fd
    },
    writeSync: (fd: number, data: string) => {
      const path = fds.get(fd)
      if (path === undefined) throw new Error(`EBADF: ${fd}`)
      state.files.set(path, String(data))
      return String(data).length
    },
    closeSync: (fd: number) => {
      fds.delete(fd)
    },
  }
  return { fs, state }
}

/** Records every spawn; an unhandled command fails loudly as status 1. */
function fakeRun(respond: (cmd: string, args: string[]) => RunResult | undefined, calls: RunCall[]) {
  return (cmd: string, args: string[], options: { timeout?: number } = {}) => {
    calls.push({ cmd, args, timeout: options.timeout })
    return (
      respond(cmd, args) ?? {
        status: 1,
        stdout: '',
        stderr: `unexpected command: ${cmd} ${args.join(' ')}`,
      }
    )
  }
}

const view = (version: string): RunResult => ({
  status: 0,
  stdout: JSON.stringify({ latest: version }),
  stderr: '',
})

/** A standard responder for `npm view` plus `npm prefix -g`. */
function respond({ selfTarget, pluginTarget }: { selfTarget?: string; pluginTarget?: string } = {}) {
  return (cmd: string, args: string[]): RunResult | undefined => {
    if (cmd !== 'npm') return undefined
    if (args[0] === 'view') {
      const pkg = args[1]
      if (pkg === SELF_NAME && selfTarget !== undefined) return view(selfTarget)
      if (pkg === PLUGIN && pluginTarget !== undefined) return view(pluginTarget)
      return { status: 1, stdout: '', stderr: 'E404 not found' }
    }
    if (args[0] === 'prefix') return { status: 0, stdout: `${PREFIX}\n`, stderr: '' }
    return undefined
  }
}

function captureOutput() {
  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '))
  }
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '))
  }
  return {
    text: () => lines.join('\n'),
    restore: () => {
      console.log = originalLog
      console.error = originalError
    },
  }
}

const writeCommands = (calls: RunCall[]) =>
  calls.filter((call) => call.cmd === 'npm' && (call.args[0] === 'i' || call.args[0] === 'install'))
const dshCalls = (calls: RunCall[]) => calls.filter((call) => call.cmd === 'dsh')
const installed = (calls: RunCall[]) =>
  calls.filter((call) => call.cmd === 'npm' && call.args[0] === 'i' && call.args[1] === '-g')

describe('runUpgrade — query failures', () => {
  test('an undetermined target is exit 1 and nothing is written or spawned', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest({ [PLUGIN]: '^1.0.0' }),
      [`${PROFILE_DIR}/node_modules/${PLUGIN}/package.json`]: installedPlugin('0.9.0'),
    })
    const calls: RunCall[] = []
    const output = captureOutput()
    let code
    try {
      // The responder only knows `npm view`, and answers it with a failure.
      code = runUpgrade(
        { yes: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(
            (cmd) =>
              cmd === 'npm' ? { status: 1, stdout: '', stderr: 'EAI_AGAIN offline' } : undefined,
            calls,
          ),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(1)
    // Every spawn was a read-only query: no npm install, no dsh.
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.cmd).toBe('npm')
      expect(call.args[0]).toBe('view')
    }
    expect(writeCommands(calls)).toEqual([])
    expect(dshCalls(calls)).toEqual([])
    expect(state.written).toEqual([])
    expect(state.removed).toEqual([])
    expect(state.made).toEqual([])
    expect(output.text()).toContain('could not determine target version for')
    expect(output.text()).toContain('nothing changed')
  })

  test('--dry-run exits 0 only when every query succeeded', () => {
    const { fs } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest(),
    })
    const calls: RunCall[] = []
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { dryRun: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(respond({ selfTarget: '0.17.4' }), calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }
    expect(code).toBe(0)
    expect(writeCommands(calls)).toEqual([])
  })
})

describe('runUpgrade — self upgrade', () => {
  test('an npm-global copy behind the registry target is installed and verified', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest(),
    })
    const calls: RunCall[] = []
    const base = respond({ selfTarget: '0.17.4' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'i' && args[1] === '-g') {
        // npm replaced the global copy.
        state.files.set(GLOBAL_MANIFEST, selfManifest('0.17.4'))
        return { status: 0, stdout: '', stderr: '' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true, noPlugins: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(response, calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(0)
    const installs = installed(calls)
    expect(installs).toHaveLength(1)
    // No npmrc configured one: the default is forwarded explicitly, because
    // npm could otherwise resolve a registry this command never saw.
    expect(output.text()).toContain(`registry ${OFFICIAL_REGISTRY} (source: default)`)
    expect(installs[0].args).toEqual([
      'i',
      '-g',
      `${SELF_NAME}@0.17.4`,
      '--registry',
      OFFICIAL_REGISTRY,
    ])
    expect(installs[0].timeout).toBe(10 * 60 * 1000)
    // The plan row was populated by the registry query.
    expect(output.text()).toContain('upgraded @aiwayds/dsh-opentui 0.17.3 -> 0.17.4')
  })

  test('DSH_UPGRADE_REGISTRY is forwarded to the install as --registry', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest(),
    })
    const calls: RunCall[] = []
    const base = respond({ selfTarget: '0.17.4' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'i' && args[1] === '-g') {
        state.files.set(GLOBAL_MANIFEST, selfManifest('0.17.4'))
        return { status: 0, stdout: '', stderr: '' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true, noPlugins: true },
        {
          pkgRoot: ROOT,
          env: { ...ENV, DSH_UPGRADE_REGISTRY: 'https://mirror.example/' },
          fs,
          run: fakeRun(response, calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(0)
    const boot = installed(calls)
    expect(boot).toHaveLength(1)
    // Explicit operator override, and only then: it must reach the install.
    expect(boot[0].args).toEqual([
      'i',
      '-g',
      `${SELF_NAME}@0.17.4`,
      '--registry',
      'https://mirror.example',
    ])
  })

  test('a registry read from ~/.npmrc is not forced onto the install argv', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest(),
      [`${HOME}/.npmrc`]: 'registry=https://mirror.example/\n',
    })
    const calls: RunCall[] = []
    const base = respond({ selfTarget: '0.17.4' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'i' && args[1] === '-g') {
        state.files.set(GLOBAL_MANIFEST, selfManifest('0.17.4'))
        return { status: 0, stdout: '', stderr: '' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true, noPlugins: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(response, calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(0)
    // The query used the resolved mirror; the install leaves the choice to npm
    // so per-scope / per-package npmrc config keeps working.
    expect(output.text()).toContain('registry https://mirror.example (source: npmrc)')
    const boot = installed(calls)
    expect(boot).toHaveLength(1)
    expect(boot[0].args).toEqual(['i', '-g', `${SELF_NAME}@0.17.4`])
  })

  /** A self upgrade whose only registry configuration is one npmrc file. */
  const selfUpgradeWithNpmrc = (npmrcPath: string, text: string) => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest(),
      [npmrcPath]: text,
    })
    const calls: RunCall[] = []
    const base = respond({ selfTarget: '0.17.4' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'i' && args[1] === '-g') {
        state.files.set(GLOBAL_MANIFEST, selfManifest('0.17.4'))
        return { status: 0, stdout: '', stderr: '' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true, noPlugins: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(response, calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }
    return { code, boot: installed(calls), text: output.text() }
  }

  // npm never reads these two files, so the query would hit the mirror while
  // the install silently went to the default registry unless argv says where.
  test('a registry read from $DSH_HOME/.npmrc is forwarded to the install', () => {
    const { code, boot, text } = selfUpgradeWithNpmrc(
      `${DSH_HOME}/.npmrc`,
      'registry=https://mirror.example/\n',
    )

    expect(code).toBe(0)
    expect(text).toContain('registry https://mirror.example (source: npmrc)')
    expect(boot).toHaveLength(1)
    expect(boot[0].args).toEqual([
      'i',
      '-g',
      `${SELF_NAME}@0.17.4`,
      '--registry',
      'https://mirror.example',
    ])
  })

  test('a registry read from <profile>/.npmrc is forwarded to the install', () => {
    const { code, boot, text } = selfUpgradeWithNpmrc(
      `${PROFILE_DIR}/.npmrc`,
      'registry=https://mirror.example/\n',
    )

    expect(code).toBe(0)
    expect(text).toContain('registry https://mirror.example (source: npmrc)')
    expect(boot).toHaveLength(1)
    expect(boot[0].args).toEqual([
      'i',
      '-g',
      `${SELF_NAME}@0.17.4`,
      '--registry',
      'https://mirror.example',
    ])
  })

  test('a failed npm install aborts before the profile is touched', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest({ [PLUGIN]: '^1.0.0' }),
      [`${PROFILE_DIR}/node_modules/${PLUGIN}/package.json`]: installedPlugin('0.9.0'),
    })
    const calls: RunCall[] = []
    const base = respond({ selfTarget: '0.17.4', pluginTarget: '1.0.0' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'i' && args[1] === '-g') {
        return { status: 1, stdout: '', stderr: 'npm ERR! EACCES: permission denied' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(response, calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(1)
    expect(state.made).toEqual([])
    expect(state.written).toEqual([])
    expect(state.removed).toEqual([])
    expect(state.copied).toEqual([])
    expect(dshCalls(calls)).toEqual([])
    expect(output.text()).toContain('upgrade aborted; profile untouched')
    expect(output.text()).toContain(
      `try npm i -g ${SELF_NAME}@0.17.4 with a writable prefix`,
    )
  })

  test('a version that did not land is a hard failure', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest({ [PLUGIN]: '^1.0.0' }),
      [`${PROFILE_DIR}/node_modules/${PLUGIN}/package.json`]: installedPlugin('0.9.0'),
      // npm reported success but the global copy is still the old build.
      [GLOBAL_MANIFEST]: selfManifest('0.17.3'),
    })
    const calls: RunCall[] = []
    const base = respond({ selfTarget: '0.17.4', pluginTarget: '1.0.0' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'i' && args[1] === '-g') {
        return { status: 0, stdout: '', stderr: '' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(response, calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(1)
    expect(state.made).toEqual([])
    expect(state.written).toEqual([])
    expect(dshCalls(calls)).toEqual([])
    expect(output.text()).toContain('installed 0.17.3, expected 0.17.4')
    expect(output.text()).toContain('upgrade aborted; profile untouched')
  })

  test('a copy that is not under the npm global prefix is skipped, not installed', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest({ [PLUGIN]: '^1.0.0' }),
      [`${PROFILE_DIR}/node_modules/${PLUGIN}/package.json`]: installedPlugin('0.9.0'),
    })
    const calls: RunCall[] = []
    const base = respond({ selfTarget: '0.17.4', pluginTarget: '1.0.0' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'dsh' && args.includes('add')) {
        // The host installed the plugin while the launcher stayed as it was.
        state.files.set(`${PROFILE_DIR}/node_modules/${PLUGIN}/package.json`, installedPlugin('1.0.0'))
        return { status: 0, stdout: '', stderr: '' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(response, calls),
          selfPath: SELF_PATH_FOREIGN,
        },
      )
    } finally {
      output.restore()
    }

    // A skipped self upgrade is NOT a failure: the plugin landed, so the run
    // is done (the "old launcher" risk is reported as a warning, not a code).
    expect(code).toBe(0)
    expect(installed(calls)).toEqual([])
    expect(dshCalls(calls)).toHaveLength(1)
    expect(output.text()).toContain('skipped (install form: foreign)')
    expect(output.text()).toContain('does not read upgrade-overrides')
    expect(output.text()).toContain('restart required: exit the TUI and run dsh-opentui again')
    expect(output.text()).toContain('upgraded 1 plugin(s)')
  })

  test('a copy already at the target spawns no install at all', () => {
    const { fs } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.4'),
      [MANIFEST]: profileManifest(),
    })
    const calls: RunCall[] = []
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true, noPlugins: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(respond({ selfTarget: '0.17.4' }), calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(0)
    expect(installed(calls)).toEqual([])
    expect(calls.filter((call) => call.args[0] === 'prefix')).toEqual([])
    expect(output.text()).toContain('nothing to do')
  })
})

describe('runUpgrade — --reset-overrides', () => {
  test('an existing override file is removed, warned about, and the run stops', () => {
    const { fs, state } = fakeFs({
      [OVERRIDE]: JSON.stringify({ version: 1, packages: { [PLUGIN]: '1.0.0' } }),
    })
    const calls: RunCall[] = []
    const output = captureOutput()
    let code
    try {
      code = runUpgrade({ resetOverrides: true }, { pkgRoot: ROOT, env: ENV, fs, run: fakeRun(respond(), calls) })
    } finally {
      output.restore()
    }

    expect(code).toBe(0)
    expect(state.removed).toEqual([OVERRIDE])
    // Terminal: no registry query, no install, no plugin phase.
    expect(calls).toEqual([])
    expect(output.text()).toContain(`removed ${OVERRIDE}`)
    expect(output.text()).toContain(
      'next provisioning will restore shipped pins; plugins may be downgraded',
    )
  })

  test('a missing override file is a no-op', () => {
    const { fs, state } = fakeFs({ [MANIFEST]: profileManifest() })
    const calls: RunCall[] = []
    const output = captureOutput()
    let code
    try {
      code = runUpgrade({ resetOverrides: true }, { pkgRoot: ROOT, env: ENV, fs, run: fakeRun(respond(), calls) })
    } finally {
      output.restore()
    }

    expect(code).toBe(0)
    expect(state.removed).toEqual([])
    expect(calls).toEqual([])
    expect(output.text()).toContain('no overrides to reset')
  })
})

describe('runUpgrade — plugin backup', () => {
  const WORKSPACE = `${PROFILE_DIR}/pnpm-workspace.yaml`

  const baseFiles = (extra: Record<string, string> = {}) => ({
    [MANIFEST]: profileManifest({ [PLUGIN]: '^1.0.0' }),
    [`${PROFILE_DIR}/node_modules/${PLUGIN}/package.json`]: installedPlugin('0.9.0'),
    ...extra,
  })

  /** Plugin-only run (--no-self) against a fake host that either installs the
   *  target or fails, so the backup and rollback paths see real copies. */
  function pluginUpgrade(files: Record<string, string>, installStatus = 0) {
    const { fs, state } = fakeFs(files)
    const calls: RunCall[] = []
    const base = respond({ pluginTarget: '1.0.0' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'dsh') {
        if (installStatus !== 0) return { status: installStatus, stdout: '', stderr: 'boom' }
        if (args.includes('add')) {
          state.files.set(`${PROFILE_DIR}/node_modules/${PLUGIN}/package.json`, installedPlugin('1.0.0'))
        }
        return { status: 0, stdout: '', stderr: '' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true, noSelf: true },
        { pkgRoot: ROOT, env: ENV, fs, run: fakeRun(response, calls), selfPath: SELF_PATH_FOREIGN },
      )
    } finally {
      output.restore()
    }
    return { code, state, calls, text: output.text() }
  }

  test('pnpm-workspace.yaml is backed up with the manifest and the lock', () => {
    const { code, state } = pluginUpgrade(
      baseFiles({
        [`${PROFILE_DIR}/pnpm-lock.yaml`]: 'lockfileVersion: 9\n',
        [WORKSPACE]: 'allowBuilds:\n  esbuild: true\n',
      }),
    )

    expect(code).toBe(0)
    const backupDir = state.made[0]
    expect(state.copied).toContainEqual([MANIFEST, `${backupDir}/package.json`])
    expect(state.copied).toContainEqual([
      `${PROFILE_DIR}/pnpm-lock.yaml`,
      `${backupDir}/pnpm-lock.yaml`,
    ])
    // A host rollback restores the user's hand-written allowBuilds from here.
    expect(state.copied).toContainEqual([WORKSPACE, `${backupDir}/pnpm-workspace.yaml`])
    expect(state.removed).toContain(backupDir)
  })

  test('the backup directory name carries a sortable stamp and the pid', () => {
    const { code, state } = pluginUpgrade(baseFiles())

    expect(code).toBe(0)
    const backupDir = state.made[0]
    expect(backupDir.startsWith(`${PROFILE_DIR}/.upgrade-backup/`)).toBe(true)
    expect(backupDir.endsWith(`-${process.pid}`)).toBe(true)
    expect(backupDir).toMatch(/\d{8}T\d{6}Z-\d+$/)
  })

  test('a file absent before the run is not created by the rollback', () => {
    const { code, state, text } = pluginUpgrade(baseFiles(), 1)

    expect(code).toBe(1)
    // Only existing files are copied; inventing a workspace file here would be
    // a profile change the user never made.
    expect(state.copied.filter(([from]) => from.endsWith('pnpm-workspace.yaml'))).toEqual([])
    expect(state.copied.filter(([, to]) => to === WORKSPACE)).toEqual([])
    expect(state.files.has(WORKSPACE)).toBe(false)
    expect(text).toContain('profile restored')
  })
})

describe('runUpgrade — confirmation and scope flags', () => {
  test('a non-interactive run without --yes refuses with exit 2 and writes nothing', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest(),
    })
    const calls: RunCall[] = []
    const output = captureOutput()
    let code
    let prompted = false
    try {
      code = runUpgrade(
        {},
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(respond({ selfTarget: '0.17.4' }), calls),
          selfPath: SELF_PATH_GLOBAL,
          isTTY: false,
          prompt: () => {
            prompted = true
          },
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(2)
    expect(prompted).toBe(false)
    expect(writeCommands(calls)).toEqual([])
    expect(state.written).toEqual([])
    expect(state.removed).toEqual([])
    expect(state.made).toEqual([])
    expect(output.text()).toContain('refusing to run non-interactively; pass --yes')
  })

  test('--no-plugins skips the plugin phase and judges only the self result', () => {
    const { fs, state } = fakeFs({
      [SELF_MANIFEST]: selfManifest('0.17.3'),
      [MANIFEST]: profileManifest({ [PLUGIN]: '^1.0.0' }),
      [`${PROFILE_DIR}/node_modules/${PLUGIN}/package.json`]: installedPlugin('0.9.0'),
    })
    const calls: RunCall[] = []
    const base = respond({ selfTarget: '0.17.4', pluginTarget: '1.0.0' })
    const response = (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'i' && args[1] === '-g') {
        state.files.set(GLOBAL_MANIFEST, selfManifest('0.17.4'))
        return { status: 0, stdout: '', stderr: '' }
      }
      return base(cmd, args)
    }
    const output = captureOutput()
    let code
    try {
      code = runUpgrade(
        { yes: true, noPlugins: true },
        {
          pkgRoot: ROOT,
          env: ENV,
          fs,
          run: fakeRun(response, calls),
          selfPath: SELF_PATH_GLOBAL,
        },
      )
    } finally {
      output.restore()
    }

    expect(code).toBe(0)
    // The plugin dependency was never even queried.
    expect(calls.filter((call) => call.args.includes(PLUGIN))).toEqual([])
    expect(dshCalls(calls)).toEqual([])
    expect(output.text()).toContain('plugins: skipped (--no-plugins)')
    expect(output.text()).not.toContain('apply not implemented')
  })
})
