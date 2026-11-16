// The plugin execution layer of `dsh-opentui upgrade`: backup, the single
// batched install, per-package verification, the override write, rollback and
// the exit-code mapping. Everything runs through an injected `run` and an
// in-memory `fs`, so no package is installed and no real profile is touched.
import { describe, expect, test } from 'bun:test'
import { parseVersion, PLUGIN_SET } from '../scripts/lib/provision-plan.mjs'
import { runUpgrade } from '../scripts/upgrade.mjs'

const ROOT = '/fixture/pkg'
const HOME = '/fixture/home'
const DSH_HOME = `${HOME}/.dsh`
const PROFILE_DIR = `${DSH_HOME}/profiles/opentui`
const MANIFEST = `${PROFILE_DIR}/package.json`
const LOCK = `${PROFILE_DIR}/pnpm-lock.yaml`
const OVERRIDE = `${PROFILE_DIR}/upgrade-overrides.json`
const ENV = { HOME, DSH_HOME }

// Names from provision-plan's PLUGIN_SET: only those can take an override,
// which is what the write path asserts before recording one. The pins are read
// from PLUGIN_SET instead of being written down, because they drift with every
// release — a hardcoded pin silently turns the "newer release" fakes into the
// shipped version and the happy path then records no override at all.
const shippedPin = (name: string): string => {
  const plugin = (PLUGIN_SET as Array<{ name: string; version: string }>).find(
    (candidate) => candidate.name === name,
  )
  if (!plugin) throw new Error(`${name} is not in PLUGIN_SET; it cannot take an override`)
  return plugin.version
}

/** One patch above `version`: the fake registry's "newer release". Derived so
 *  a pin bump can never make it equal to (or below) the shipped pin. */
const nextPatch = (version: string): string => {
  const parsed = parseVersion(version)
  if (!parsed) throw new Error(`unparsable version: ${version}`)
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

/** One patch below `version`, for the "registry lags the shipped pin" case. */
const previousPatch = (version: string): string => {
  const parsed = parseVersion(version)
  if (!parsed || parsed.patch === 0) throw new Error(`no patch to step below: ${version}`)
  return `${parsed.major}.${parsed.minor}.${parsed.patch - 1}`
}

const CRON = '@aiwayds/dsh-cron'
const CRON_PIN = shippedPin(CRON)
const CRON_NEXT = nextPatch(CRON_PIN)
const VAULT = '@aiwayds/dsh-vault'
const VAULT_PIN = shippedPin(VAULT)
const VAULT_NEXT = nextPatch(VAULT_PIN)
const TOPICS = '@aiwayds/dsh-topics-memory'
const WORKFLOW = '@aiwayds/dsh-workflow'

type RunResult = { status: number; stdout: string; stderr: string }
type RunOptions = { timeout?: number; env?: Record<string, string | undefined> }
type RunCall = { cmd: string; args: string[]; options: RunOptions }
type FsState = ReturnType<typeof fakeFs>['state']

const manifest = (dependencies: Record<string, string>) =>
  JSON.stringify({ name: 'opentui-profile', dependencies })

const pkg = (name: string, version: string) => JSON.stringify({ name, version })

const installedPath = (name: string) =>
  `${PROFILE_DIR}/node_modules/${name.split('/').join('/')}/package.json`

/** In-memory fs. `copyFileSync` moves content too, so the rollback's
 *  `originalSpecs` can read the manifest from its backup copy. */
function fakeFs(files: Record<string, string>) {
  const state = {
    files: new Map(Object.entries(files)),
    written: [] as string[],
    removed: [] as string[],
    made: [] as string[],
    copied: [] as Array<[string, string]>,
    renamed: [] as Array<[string, string]>,
    ops: [] as string[],
  }
  const under = (path: string) => {
    const prefix = `${path}/`
    return [...state.files.keys()].filter((key) => key.startsWith(prefix))
  }
  const fs = {
    readFileSync: (path: string) => {
      const text = state.files.get(path)
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      return text
    },
    writeFileSync: (path: string, data: string) => {
      state.written.push(path)
      state.ops.push(`write:${path}`)
      state.files.set(path, String(data))
    },
    existsSync: (path: string) => state.files.has(path) || under(path).length > 0,
    mkdirSync: (path: string) => {
      state.made.push(path)
    },
    rmSync: (path: string, options?: { recursive?: boolean; force?: boolean }) => {
      state.removed.push(path)
      state.files.delete(path)
      if (options?.recursive) for (const key of under(path)) state.files.delete(key)
    },
    rmdirSync: (path: string) => {
      state.removed.push(path)
      state.files.delete(path)
    },
    copyFileSync: (from: string, to: string) => {
      state.copied.push([from, to])
      const text = state.files.get(from)
      if (text !== undefined) state.files.set(to, text)
    },
    renameSync: (from: string, to: string) => {
      state.renamed.push([from, to])
      state.ops.push(`rename:${from}->${to}`)
      const text = state.files.get(from)
      if (text !== undefined) state.files.set(to, text)
      state.files.delete(from)
    },
  }
  return { fs, state }
}

function fakeRun(respond: (cmd: string, args: string[]) => RunResult | undefined, calls: RunCall[]) {
  return (cmd: string, args: string[], options: RunOptions = {}) => {
    calls.push({ cmd, args, options })
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

const dshCalls = (calls: RunCall[]) => calls.filter((call) => call.cmd === 'dsh')

/** Run the command with `--no-self` (the self path has its own tests) and
 *  `--yes`, so only the plugin phase is exercised. The responder receives the
 *  live fs state so it can simulate what the host installs. */
function upgrade(
  files: Record<string, string>,
  respond: (cmd: string, args: string[], state: FsState) => RunResult | undefined,
) {
  const { fs, state } = fakeFs(files)
  const calls: RunCall[] = []
  const output = captureOutput()
  try {
    const code = runUpgrade(
      { yes: true, noSelf: true },
      { pkgRoot: ROOT, env: ENV, fs, run: fakeRun((cmd, args) => respond(cmd, args, state), calls) },
    )
    return { code, state, calls, text: output.text() }
  } finally {
    output.restore()
  }
}

/** The backup directory the run created (the fake fs records the mkdir). */
const backupDirOf = (state: { made: string[] }) => state.made[0]

describe('plugin phase — the happy path', () => {
  test('one batched install lands both packages and records both overrides', () => {
    const { code, state, calls, text } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}`, [VAULT]: `^${VAULT_PIN}` }),
        [LOCK]: 'lockfileVersion: 9\n',
        [installedPath(CRON)]: pkg(CRON, CRON_PIN),
        [installedPath(VAULT)]: pkg(VAULT, VAULT_PIN),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') {
          if (args[0] !== 'view') return undefined
          if (args[1] === CRON) return view(CRON_NEXT)
          if (args[1] === VAULT) return view(VAULT_NEXT)
          return undefined
        }
        // The host installed both targets in one call.
        state.files.set(installedPath(CRON), pkg(CRON, CRON_NEXT))
        state.files.set(installedPath(VAULT), pkg(VAULT, VAULT_NEXT))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(0)
    const adds = dshCalls(calls)
    expect(adds).toHaveLength(1)
    expect(adds[0].args).toEqual([
      'plugin',
      '--profile',
      'opentui',
      'add',
      '--save-exact',
      `${CRON}@${CRON_NEXT}`,
      `${VAULT}@${VAULT_NEXT}`,
    ])
    expect(adds[0].options.timeout).toBe(10 * 60 * 1000)
    // DSH_HOME reaches the child: the host must act on the selected profile.
    expect(adds[0].options.env).toEqual(ENV)

    const backupDir = backupDirOf(state)
    expect(backupDir).toContain(`${PROFILE_DIR}/.upgrade-backup/`)
    expect(state.copied).toEqual([
      [MANIFEST, `${backupDir}/package.json`],
      [LOCK, `${backupDir}/pnpm-lock.yaml`],
    ])

    const doc = JSON.parse(state.files.get(OVERRIDE) as string)
    expect(doc.packages[CRON].version).toBe(CRON_NEXT)
    expect(doc.packages[VAULT].version).toBe(VAULT_NEXT)

    // Success removes the backup directory AND its now-empty hidden parent.
    expect(state.removed).toEqual([backupDir, `${PROFILE_DIR}/.upgrade-backup`])
    expect(text).toContain('2 upgraded, 0 up to date, 0 mismatched, 0 excluded')
    expect(text).toContain('upgraded 2 plugin(s)')
    expect(text).toContain('restart required: exit the TUI and run dsh-opentui again')
  })

  test('success leaves no empty .upgrade-backup tree behind', () => {
    const { code, state } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}` }),
        [installedPath(CRON)]: pkg(CRON, CRON_PIN),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === CRON ? view(CRON_NEXT) : undefined
        state.files.set(installedPath(CRON), pkg(CRON, CRON_NEXT))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(0)
    const backupDir = backupDirOf(state)
    expect(state.removed).toEqual([backupDir, `${PROFILE_DIR}/.upgrade-backup`])
    // The stamp directory's files are gone and neither directory is left.
    expect(state.files.has(`${backupDir}/package.json`)).toBe(false)
    expect(state.made.length).toBe(1)
  })
})

describe('plugin phase — install failure and rollback', () => {
  test('a non-zero install restores the backup and converges the old specs', () => {
    const { code, state, calls, text } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}`, [VAULT]: `^${VAULT_PIN}` }),
        [LOCK]: 'lockfileVersion: 9\n',
        [installedPath(CRON)]: pkg(CRON, CRON_PIN),
        [installedPath(VAULT)]: pkg(VAULT, VAULT_PIN),
      },
      (cmd, args) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') {
          if (args[0] !== 'view') return undefined
          if (args[1] === CRON) return view(CRON_NEXT)
          if (args[1] === VAULT) return view(VAULT_NEXT)
          return undefined
        }
        // The first (targeted) batch fails; the convergence batch succeeds.
        if (args.includes(`${CRON}@${CRON_NEXT}`)) {
          return { status: 1, stderr: 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION: too fresh' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(1)
    const adds = dshCalls(calls)
    expect(adds).toHaveLength(2)
    expect(adds[0].args).toContain(`${CRON}@${CRON_NEXT}`)
    // The convergence call re-adds the ORIGINAL specs, read from the backup.
    expect(adds[1].args).toEqual([
      'plugin',
      '--profile',
      'opentui',
      'add',
      '--save-exact',
      `${CRON}@^${CRON_PIN}`,
      `${VAULT}@^${VAULT_PIN}`,
    ])

    const backupDir = backupDirOf(state)
    // Files copied back to their original locations.
    for (const name of ['package.json', 'pnpm-lock.yaml']) {
      expect(state.copied).toContainEqual([`${backupDir}/${name}`, `${PROFILE_DIR}/${name}`])
    }
    // The override never existed, so the rollback removes any stray file.
    expect(state.removed).toContain(OVERRIDE)
    expect(state.removed).not.toContain(backupDir)
    expect(text).toContain('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')
    expect(text).toContain(`upgrade failed at plugin install; profile restored from ${backupDir}`)
    expect(text).not.toContain('restart required')
  })
})

describe('plugin phase — verification', () => {
  test('a package that did not reach its target is a mismatch, not an override', () => {
    const { code, state, text } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}` }),
        [installedPath(CRON)]: pkg(CRON, CRON_PIN),
      },
      (cmd, args) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === CRON ? view(CRON_NEXT) : undefined
        // pnpm exited 0 but the profile stayed on the old version.
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(3)
    expect(state.written).toEqual([])
    expect(text).toContain(`mismatch: ${CRON} expected ${CRON_NEXT}, installed ${CRON_PIN}`)
    expect(text).toContain('possible downgrade')
    expect(text).toContain('0 upgraded, 0 up to date, 1 mismatched, 0 excluded')
    // Partial success keeps the backup: a rollback is still possible by hand.
    expect(state.removed).not.toContain(backupDirOf(state))
  })
})

describe('plugin phase — --save-exact compatibility', () => {
  test('a rejected flag is retried once without it and the override is still written', () => {
    const { code, state, calls, text } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}` }),
        [installedPath(CRON)]: pkg(CRON, CRON_PIN),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === CRON ? view(CRON_NEXT) : undefined
        if (args.includes('--save-exact')) {
          return { status: 2, stderr: "error: unknown option '--save-exact'" }
        }
        state.files.set(installedPath(CRON), pkg(CRON, CRON_NEXT))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(0)
    const adds = dshCalls(calls)
    expect(adds).toHaveLength(2)
    expect(adds[1].args).toEqual(['plugin', '--profile', 'opentui', 'add', `${CRON}@${CRON_NEXT}`])
    expect(text).toContain('--save-exact not supported by host; relying on upgrade-overrides')
    const doc = JSON.parse(state.files.get(OVERRIDE) as string)
    expect(doc.packages[CRON].version).toBe(CRON_NEXT)
  })
})

describe('plugin phase — override policy', () => {
  test('landing exactly on the shipped pin writes no override and counts as up to date', () => {
    const { code, state, text } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}` }),
        [installedPath(CRON)]: pkg(CRON, '0.6.0'),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === CRON ? view(CRON_PIN) : undefined
        state.files.set(installedPath(CRON), pkg(CRON, CRON_PIN))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(0)
    expect(state.written).toEqual([])
    expect(state.files.has(OVERRIDE)).toBe(false)
    expect(text).toContain('0 upgraded, 1 up to date, 0 mismatched, 0 excluded')
  })

  test('an existing unrelated override entry survives the merge', () => {
    const existing = JSON.stringify({
      version: 1,
      packages: {
        [TOPICS]: { version: '0.26.1', shippedPin: '0.26.0' },
        [WORKFLOW]: '0.2.2',
      },
    })
    const { code, state } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}` }),
        [OVERRIDE]: existing,
        [installedPath(CRON)]: pkg(CRON, CRON_PIN),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === CRON ? view(CRON_NEXT) : undefined
        state.files.set(installedPath(CRON), pkg(CRON, CRON_NEXT))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(0)
    const doc = JSON.parse(state.files.get(OVERRIDE) as string)
    expect(doc.packages[TOPICS]).toEqual({ version: '0.26.1', shippedPin: '0.26.0' })
    expect(doc.packages[WORKFLOW]).toBe('0.2.2')
    expect(doc.packages[CRON].version).toBe(CRON_NEXT)
    // The pre-existing file was part of the backup.
    expect(state.copied).toContainEqual([OVERRIDE, `${backupDirOf(state)}/upgrade-overrides.json`])
  })

  test('the override is written to a .tmp file, then renamed into place', () => {
    const { code, state } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}` }),
        [installedPath(CRON)]: pkg(CRON, CRON_PIN),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === CRON ? view(CRON_NEXT) : undefined
        state.files.set(installedPath(CRON), pkg(CRON, CRON_NEXT))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(0)
    const tmp = `${OVERRIDE}.tmp`
    // Same-directory temp path, never the live file directly.
    expect(state.written).toEqual([tmp])
    expect(state.renamed).toEqual([[tmp, OVERRIDE]])
    // Order matters: the temp write must precede the rename.
    const writeAt = state.ops.indexOf(`write:${tmp}`)
    const renameAt = state.ops.indexOf(`rename:${tmp}->${OVERRIDE}`)
    expect(writeAt).toBeGreaterThanOrEqual(0)
    expect(renameAt).toBeGreaterThan(writeAt)
    // The rename consumed the temp file.
    expect(state.files.has(tmp)).toBe(false)
    expect(JSON.parse(state.files.get(OVERRIDE) as string).packages[CRON].version).toBe(CRON_NEXT)
  })

  test('a package outside PLUGIN_SET gets no override and an accurate warning', () => {
    const THIRD_PARTY = 'third-party-plugin'
    const { code, state, text } = upgrade(
      {
        [MANIFEST]: manifest({ [THIRD_PARTY]: '^1.0.0' }),
        [installedPath(THIRD_PARTY)]: pkg(THIRD_PARTY, '1.0.0'),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') {
          return args[0] === 'view' && args[1] === THIRD_PARTY ? view('1.1.0') : undefined
        }
        state.files.set(installedPath(THIRD_PARTY), pkg(THIRD_PARTY, '1.1.0'))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(0)
    expect(state.files.has(OVERRIDE)).toBe(false)
    expect(text).toContain(`${THIRD_PARTY}: not managed by provisioning; no override recorded`)
    // Provisioning never installs this package, so it cannot "reinstall a pin".
    expect(text).not.toContain('the next start will reinstall the shipped pin')
  })

  test('a version provisioning would ignore is not recorded, and a warning says so', () => {
    // Derived from the pin: the registry's latest is an "upgrade" on disk yet
    // still older than the shipped pin, so an override could never apply.
    const stale = previousPatch(VAULT_PIN)
    const older = previousPatch(stale)
    const { code, state, text } = upgrade(
      {
        [MANIFEST]: manifest({ [VAULT]: `^${VAULT_PIN}` }),
        [installedPath(VAULT)]: pkg(VAULT, older),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === VAULT ? view(stale) : undefined
        state.files.set(installedPath(VAULT), pkg(VAULT, stale))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    expect(code).toBe(0)
    expect(state.files.has(OVERRIDE)).toBe(false)
    expect(text).toContain(`${VAULT}: an override at ${stale} would be ignored by provisioning`)
    expect(text).toContain('not recorded')
  })

  test('an unusable override file is left untouched and reported as partial', () => {
    const broken = '{ this is not json'
    const { code, state, text } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}` }),
        [OVERRIDE]: broken,
        [installedPath(CRON)]: pkg(CRON, CRON_PIN),
      },
      (cmd, args, state) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === CRON ? view(CRON_NEXT) : undefined
        state.files.set(installedPath(CRON), pkg(CRON, CRON_NEXT))
        return { status: 0, stdout: '', stderr: '' }
      },
    )

    // The install landed, but nothing could be recorded: the file may hold
    // hand-edited content, so it is not clobbered.
    expect(code).toBe(3)
    expect(state.files.get(OVERRIDE)).toBe(broken)
    expect(state.written).toEqual([])
    expect(text).toContain('is not a usable override document; leaving it untouched')
  })
})

describe('plugin phase — nothing to do', () => {
  test('an already-latest plugin spawns no install and creates no backup', () => {
    const { code, state, calls, text } = upgrade(
      {
        [MANIFEST]: manifest({ [CRON]: `^${CRON_PIN}` }),
        [installedPath(CRON)]: pkg(CRON, CRON_NEXT),
      },
      (cmd, args) => {
        if (cmd !== 'npm' && cmd !== 'dsh') return undefined
        if (cmd === 'npm') return args[0] === 'view' && args[1] === CRON ? view(CRON_NEXT) : undefined
        return undefined
      },
    )

    expect(code).toBe(0)
    expect(state.made).toEqual([])
    expect(state.copied).toEqual([])
    expect(state.written).toEqual([])
    expect(dshCalls(calls)).toEqual([])
    expect(text).toContain('plugins: already up to date')
  })
})
