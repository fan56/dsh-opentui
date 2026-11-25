#!/usr/bin/env node
/**
 * Minimal `dsh-opentui upgrade` — upgrade the launcher package itself, nothing
 * else. No companions, no $DSH_HOME, no provisioning, no migration: those are
 * the next launch's job. The only npm commands are `npm view`, `npm prefix -g`,
 * `npm i -g` and (after install) the version re-check under the global prefix.
 *
 * WHY A SEPARATE MODULE: the bin is a top-level script (importing it would RUN
 * it). Everything decision-making here is exported as a pure function over
 * plain data; the process-touching parts (npm exec, package.json reads, logs,
 * exit codes) are injected through `runUpgrade`'s context so tests never
 * install anything.
 *
 * Registry contract (deliberately does NOT parse .npmrc): npm is trusted with
 * its own configuration. `DSH_UPGRADE_REGISTRY` is the one explicit override —
 * when set it is appended as `--registry <value>` to BOTH `npm view` and
 * `npm i -g`, so resolution and installation cannot drift apart.
 */
import { spawnSync } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLauncherVersion } from '../bin/lib/launcher.mjs'
import { compareVersions, isExactVersion } from './lib/host-compat.mjs'

export { compareVersions } from './lib/host-compat.mjs'

export const PACKAGE_NAME = '@aiwayds/dsh-opentui'
export const DEFAULT_TAG = 'latest'
export const REGISTRY_ENV = 'DSH_UPGRADE_REGISTRY'
const VIEW_TIMEOUT_MS = 15_000
const PREFIX_TIMEOUT_MS = 10_000

/**
 * Last-resort scrub for third-party text (npm's own error strings) that may
 * embed a credential-bearing URL. Removes the userinfo segment only.
 */
function redactSecrets(text) {
	return String(text).replace(/\b(https?:\/\/)[^/@\s]+@/gi, (_match, scheme) => scheme)
}

/**
 * Safe rendering of a registry URL for ANY user-visible output (commands we
 * print, manual instructions, dry-run, error details). Credentials embedded in
 * `https://user:token@host/` must never reach a terminal or CI log. The value
 * passed to `npm` is always the ORIGINAL string — only display goes through
 * here. Unparseable input is replaced, never echoed verbatim.
 */
export function displayRegistry(url) {
  if (typeof url !== 'string' || url.trim() === '') return '<invalid registry>'
  try {
    const parsed = new URL(url)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) {
      return '<invalid registry>'
    }
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return '<invalid registry>'
  }
}

// --- argv -------------------------------------------------------------------

/** Pure parse of the subcommand's own argv. No process access, no logging. */
export function parseUpgradeArgs(argv = []) {
	const args = Array.isArray(argv) ? argv : []
	let tag = DEFAULT_TAG
	let tagSeen = false
	let dryRun = false
	let help = false
	const rest = []
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--help' || arg === '-h') {
			help = true
			continue
		}
		if (arg === '--dry-run') {
			dryRun = true
			continue
		}
		if (arg === '--tag') {
			const value = args[i + 1]
		if (value === undefined || value === '' || value.startsWith('-')) {
			return { tag, dryRun, help, rest, error: 'missing-value', errorFlag: '--tag' }
		}
		if (tagSeen) {
			return { tag, dryRun, help, rest, error: 'duplicate-tag', errorValue: value, errorPrevious: tag }
		}
		tag = value
		tagSeen = true
		i++
		continue
	}
	if (arg.startsWith('--tag=')) {
		const value = arg.slice('--tag='.length)
		if (value === '') return { tag, dryRun, help, rest, error: 'missing-value', errorFlag: '--tag' }
		if (tagSeen) {
			return { tag, dryRun, help, rest, error: 'duplicate-tag', errorValue: value, errorPrevious: tag }
		}
		tag = value
		tagSeen = true
		continue
	}
		rest.push(arg)
	}
	if (!help && rest.length > 0) {
		return { tag, dryRun, help, rest, error: 'unknown', errorValue: rest[0] }
	}
	if (!help && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) {
		return { tag, dryRun, help, rest, error: 'invalid-tag', errorValue: tag }
	}
	return { tag, dryRun, help, rest, error: null }
}

/** Dedicated subcommand help (also used by `node scripts/upgrade.mjs --help`). */
export function formatUpgradeUsage() {
	return [
		'Usage: dsh-opentui upgrade [--tag <dist-tag>] [--dry-run]',
		'',
		'Upgrade the launcher package (@aiwayds/dsh-opentui) itself. Profiles,',
		'companions and migrations are left to the next launch.',
		'',
	'  --tag <dist-tag>   npm dist-tag to resolve (default: latest)',
	'                     letters/digits first, then letters, digits, . _ - only',
	'  --dry-run          resolve and print the command, do not install',
	'                     (no command is printed when the target is equal/older)',
	'  -h, --help         print this help and exit',
	'',
	`Requires an npm global install (--dry-run is exempt); otherwise use npm i -g ${PACKAGE_NAME}.`,
	`Set ${REGISTRY_ENV} to pass --registry <url> to both npm view and npm i -g.`,
	'The tag is only a key into npm view\'s dist-tags JSON; it never enters npm argv.',
	].join('\n')
}

// --- npm helpers (all process access goes through the injected exec) --------

const defaultExec = (cmd, args, opts) => spawnSync(cmd, args, opts)

/** `npm view @aiwayds/dsh-opentui dist-tags --json` (+ optional --registry). */
export function npmViewArgs({ registry } = {}) {
	const args = ['view', PACKAGE_NAME, 'dist-tags', '--json']
	if (registry) args.push('--registry', registry)
	return args
}

/** The exact install command we would run (argv form, executable first). */
export function npmInstallCommand({ targetVersion, registry } = {}) {
	const spec = registry
		? ['i', '-g', `${PACKAGE_NAME}@${targetVersion}`, '--registry', registry]
		: ['i', '-g', `${PACKAGE_NAME}@${targetVersion}`]
	return ['npm', ...spec]
}

function registryFailureDetail(registry) {
	if (registry) return displayRegistry(registry)
	// Do not name a hardcoded public URL here: with no override npm uses its own
	// configured registry, which may be a private mirror.
	return `npm 自身配置的 registry（可用 ${REGISTRY_ENV} 指定）`
}

/** Display-only rendering of an argv command: scrub --registry credentials. */
function formatCommand(command) {
	return command
		.map((arg, i) => (i > 0 && command[i - 1] === '--registry' ? displayRegistry(arg) : arg))
		.join(' ')
}

const stripV = (value) => String(value).trim().replace(/^v/, '')

/**
 * Resolve a dist-tag through npm. Injected `exec` keeps this testable; a failed
 * / malformed / tagless registry query throws with the registry URL in the
 * message so the user can tell where the lookup went.
 *
 * `tag` is only used as a key into the returned dist-tags JSON — it is NEVER
 * appended to the npm argv, so no user-supplied string can reach npm as a flag.
 */
export function resolveTargetVersion({ tag = DEFAULT_TAG, registry, exec = defaultExec } = {}) {
	const args = npmViewArgs({ registry })
	let result
	try {
		result = exec('npm', args, { encoding: 'utf8', timeout: VIEW_TIMEOUT_MS })
	} catch (error) {
		throw new Error(
			`无法从 npm registry 读取 ${PACKAGE_NAME} 的 dist-tag '${tag}'；registry: ${registryFailureDetail(registry)}（${error?.message ?? error}）`,
		)
	}
	if (result?.error !== undefined) {
		throw new Error(
			`无法从 npm registry 读取 ${PACKAGE_NAME} 的 dist-tag '${tag}'；registry: ${registryFailureDetail(registry)}（${result.error.message ?? result.error}）`,
		)
	}
	if (result?.status !== 0) {
		throw new Error(
			`无法从 npm registry 读取 ${PACKAGE_NAME} 的 dist-tag '${tag}'（npm view 退出 ${result?.status}）；registry: ${registryFailureDetail(registry)}`,
		)
	}
	let tags
	try {
		tags = JSON.parse(String(result?.stdout ?? ''))
	} catch {
		throw new Error(
			`npm view 返回的 dist-tags 不是合法 JSON；registry: ${registryFailureDetail(registry)}`,
		)
	}
	const raw = tags?.[tag]
	if (typeof raw !== 'string' || raw.trim() === '') {
		throw new Error(
			`${PACKAGE_NAME} 没有 '${tag}' dist-tag；registry: ${registryFailureDetail(registry)}`,
		)
	}
	const version = stripV(raw)
	if (!isExactVersion(version)) {
		throw new Error(`dist-tag '${tag}' 的版本 ${JSON.stringify(raw)} 不是精确 semver；registry: ${registryFailureDetail(registry)}`)
	}
	return version
}

/**
 * `npm prefix -g` through the injected executor. By default returns undefined
 * on any failure (used by the post-install re-check, where a missing prefix is
 * just one of the reasons verification can fail). With `strict: true` it throws
 * a descriptive error instead: the pre-install guard must not confuse "npm is
 * unavailable / the query failed" with "this is a source-tree checkout".
 */
export function captureGlobalPrefix(exec = defaultExec, { strict = false } = {}) {
	let result
	try {
		result = exec('npm', ['prefix', '-g'], { encoding: 'utf8', timeout: PREFIX_TIMEOUT_MS })
	} catch (error) {
		if (strict) throw new Error(`无法确定 npm 全局前缀（npm prefix -g 调用失败：${error?.message ?? error}）`)
		return undefined
	}
	if (result?.error !== undefined) {
		if (strict) throw new Error(`无法确定 npm 全局前缀（npm prefix -g 失败：${result.error.message ?? result.error}）`)
		return undefined
	}
	if (result?.status !== 0) {
		if (strict) throw new Error(`无法确定 npm 全局前缀（npm prefix -g 退出 ${result?.status}）`)
		return undefined
	}
	const prefix = String(result?.stdout ?? '').trim()
	if (!prefix) {
		if (strict) throw new Error('无法确定 npm 全局前缀（npm prefix -g 未返回路径）')
		return undefined
	}
	return prefix
}

/**
 * A global package dir that is a symlink is an `npm link` development install,
 * not a package npm can upgrade in place. Detect it BEFORE installing so we
 * never mutate the link target (the source tree).
 */
export function findLinkedGlobalInstall(prefix) {
	if (!prefix) return undefined
	for (const candidate of globalPackagePaths(prefix)) {
		try {
			if (lstatSync(candidate).isSymbolicLink()) return candidate
		} catch {
			/* not present — keep looking */
		}
	}
	return undefined
}

/** Where a global install of this package lives under an npm prefix. */
export function globalPackagePaths(prefix) {
	if (!prefix) return []
	return [
		join(prefix, 'lib', 'node_modules', PACKAGE_NAME),
		join(prefix, 'node_modules', PACKAGE_NAME),
	]
}

function normalizePath(path) {
	try {
		return realpathSync(resolve(path))
	} catch {
		return resolve(path)
	}
}

/**
 * Whether the RUNNING copy is the npm-global install of this package. A source
 * tree / pnpm store / custom prefix is not: upgrading it in place would leave
 * the actual global copy untouched. Both values can be injected (pure); with
 * only `exec` injected the prefix is read via `npm prefix -g`.
 */
export function isGlobalInstall({ globalPrefix, runningRoot, exec = defaultExec } = {}) {
	const prefix = globalPrefix ?? captureGlobalPrefix(exec)
	if (!prefix || !runningRoot) return false
	const root = normalizePath(runningRoot)
	// Only the package paths under the global prefix count. The prefix itself
	// being the running root is not a global package install.
	return globalPackagePaths(prefix).some((candidate) => normalizePath(candidate) === root)
}

// --- pure decision ----------------------------------------------------------

/**
 * Decide what to do. Pure: no exec, no fs, no process. `cmp` is -1 / 0 / 1 for
 * target vs current. Dry-run reports the command but never installs, so it
 * deliberately skips the global-install guard.
 */
export function planUpgrade({ targetVersion, currentVersion, dryRun = false, registry, isGlobal = false } = {}) {
	const cmp = compareVersions(targetVersion, currentVersion)
	const command = npmInstallCommand({ targetVersion, registry })
	if (dryRun) return { action: 'dry-run', cmp, command, targetVersion, currentVersion }
	if (cmp === 0) return { action: 'up-to-date', cmp, command: null, targetVersion, currentVersion }
	if (cmp < 0) return { action: 'downgrade', cmp, command: null, targetVersion, currentVersion }
	if (!isGlobal) return { action: 'not-global', cmp, command, targetVersion, currentVersion }
	return { action: 'install', cmp, command, targetVersion, currentVersion }
}

/** After a successful install, re-read the version under `npm prefix -g`. */
export function verifyInstalledVersion({ targetVersion, exec = defaultExec, readVersion = readLauncherVersion } = {}) {
	const prefix = captureGlobalPrefix(exec)
	for (const candidate of globalPackagePaths(prefix)) {
		try {
			if (readVersion(candidate) === targetVersion) return { ok: true, path: candidate, version: targetVersion }
		} catch {
			/* try the next candidate */
		}
	}
	return { ok: false, prefix, version: undefined }
}

// --- process-facing entry ---------------------------------------------------

/** Run the subcommand; returns an exit code (never calls process.exit itself). */
export async function runUpgrade(argv = [], ctx = {}) {
	const {
		env = process.env,
		exec = defaultExec,
		pkgRoot = dirname(dirname(fileURLToPath(import.meta.url))),
		readVersion = readLauncherVersion,
		out: rawOut = (line) => console.log(line),
		err: rawErr = (line) => console.error(line),
	} = ctx
	// Every line this command emits passes through the redactor: a registry URL
	// (or an npm error quoting one) must never leak credentials into a terminal
	// or CI log. Arguments handed to `exec` are untouched.
	const out = (line) => rawOut(redactSecrets(line))
	const err = (line) => rawErr(redactSecrets(line))

	const parsed = parseUpgradeArgs(argv)
	if (parsed.help) {
		out(formatUpgradeUsage())
		return 0
	}
	if (parsed.error === 'missing-value') {
		err(`dsh-opentui upgrade: option '--tag' requires a value`)
		err(formatUpgradeUsage())
		return 2
	}
	if (parsed.error === 'duplicate-tag') {
		err(`dsh-opentui upgrade: option '--tag' given more than once: '${parsed.errorPrevious}' and '${parsed.errorValue}'`)
		err(formatUpgradeUsage())
		return 2
	}
	if (parsed.error === 'invalid-tag') {
		err(`dsh-opentui upgrade: invalid dist-tag '${parsed.errorValue}'；只允许字母/数字开头，其后为字母、数字、. _ -（不含空白或 URL 元字符）`)
		err(formatUpgradeUsage())
		return 2
	}
	if (parsed.error) {
		err(`dsh-opentui upgrade: unknown argument '${parsed.errorValue}'`)
		err(formatUpgradeUsage())
		return 2
	}

	// An explicit override must be a real http(s) URL. A typo must fail loudly
	// instead of silently falling back to whatever registry npm has configured.
	const rawRegistry = typeof env?.[REGISTRY_ENV] === 'string' ? env[REGISTRY_ENV].trim() : ''
	let registry
	if (rawRegistry !== '') {
		if (!/^https?:\/\//i.test(rawRegistry)) {
			err(`dsh-opentui upgrade: ${REGISTRY_ENV} 必须以 http:// 或 https:// 开头（合法 URL），收到 ${JSON.stringify(displayRegistry(rawRegistry))}；已中止。`)
			return 1
		}
		registry = rawRegistry
	}

	let targetVersion
	try {
		targetVersion = resolveTargetVersion({ tag: parsed.tag, registry, exec })
	} catch (error) {
		err(`dsh-opentui upgrade: ${error?.message ?? error}`)
		return 1
	}

	const currentVersion = readVersion(pkgRoot)
	if (!currentVersion) {
		err(`dsh-opentui upgrade: 无法从 ${join(pkgRoot, 'package.json')} 读取当前版本，已中止。`)
		return 1
	}

	let cmp
	try {
		cmp = compareVersions(targetVersion, currentVersion)
	} catch (error) {
		err(`dsh-opentui upgrade: 版本比较失败（当前 ${JSON.stringify(currentVersion)}，目标 ${JSON.stringify(targetVersion)}）：${error?.message ?? error}`)
		return 1
	}

	let isGlobal = false
	if (!parsed.dryRun && cmp > 0) {
		// Resolve the global prefix strictly: a failed `npm prefix -g` is NOT the
		// same as "running from a source tree", and must never end in an install.
		let prefix
		try {
			prefix = captureGlobalPrefix(exec, { strict: true })
		} catch (error) {
			err(`dsh-opentui upgrade: ${error?.message ?? error}；未执行安装。`)
			return 1
		}
		const linked = findLinkedGlobalInstall(prefix)
		if (linked) {
			err(`dsh-opentui upgrade: ${linked} 是 npm link 的符号链接（linked development install），不是 npm 全局安装；升级已中止。请在源码目录更新后重新 link，或重新执行 npm i -g ${PACKAGE_NAME}。`)
			return 1
		}
		isGlobal = isGlobalInstall({ globalPrefix: prefix, runningRoot: pkgRoot })
	}
	const plan = planUpgrade({
		targetVersion,
		currentVersion,
		dryRun: parsed.dryRun,
		registry,
		isGlobal,
	})

	if (plan.action === 'dry-run') {
		out(`dsh-opentui upgrade: 当前 ${currentVersion}，目标（${parsed.tag}）${targetVersion}（${plan.cmp > 0 ? '有可用升级' : plan.cmp === 0 ? '已是最新' : '目标版本更旧'}）。`)
		out(`dsh-opentui upgrade: --dry-run，不会执行安装。`)
		if (plan.cmp > 0) out(`dsh-opentui upgrade: 将执行: ${formatCommand(plan.command)}`)
		return 0
	}

	if (plan.action === 'up-to-date') {
		out(`dsh-opentui upgrade: already up to date (${currentVersion}).`)
		return 0
	}

	if (plan.action === 'downgrade') {
		err(`dsh-opentui upgrade: refusing to downgrade from ${currentVersion} to ${targetVersion}.`)
		return 1
	}

	if (plan.action === 'not-global') {
		err(`dsh-opentui upgrade: 当前不是 npm 全局安装，请手动执行 npm i -g ${PACKAGE_NAME}@${targetVersion}${registry ? ` --registry ${displayRegistry(registry)}` : ''}。`)
		return 1
	}

	out(`dsh-opentui upgrade: ${formatCommand(plan.command)}`)
	// Capture npm output instead of inheriting its file descriptors: every line
	// must pass through this process's redactor before reaching the terminal.
	const install = exec('npm', plan.command.slice(1), {
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
	})
	if (install?.stdout) out(String(install.stdout))
	if (install?.stderr) err(String(install.stderr))
	if (install?.error !== undefined || install?.status !== 0) {
		err(`dsh-opentui upgrade: npm 安装失败${install?.status !== undefined ? `（退出 ${install.status}）` : ''}，已中止。`)
		return 1
	}
	const verified = verifyInstalledVersion({ targetVersion, exec, readVersion })
	if (!verified.ok) {
		err(`dsh-opentui upgrade: 安装后校验失败：${verified.prefix ?? '未知 prefix'} 下找不到版本 ${targetVersion} 的 ${PACKAGE_NAME}。`)
		return 1
	}
	out('dsh-opentui upgrade: 升级完成，退出并重新运行 dsh-opentui。')
	return 0
}

// Direct invocation only: importing this module (from the bin or tests) must
// never run a registry query.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await runUpgrade(process.argv.slice(2)))
}
