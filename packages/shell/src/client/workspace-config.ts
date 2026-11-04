/**
 * Workspace-local config overlay — client-mode port (ADR-0005 decision 4),
 * bucket (d).
 *
 * `<workspace>/.dsh/config.yml` holds ONLY theme + model preferences that
 * override the user's global (profile/home) config when the TUI runs in that
 * workspace. Credentials and plugin installs must NEVER live here — the file
 * sits next to the user's working tree and would leak into version control
 * (CONTEXT.md "Workspace-local config"). The host has no workspace config
 * layer (deliberate); this is a purely client-side mechanism.
 *
 * Schema (v1):
 *
 *   # dsh-opentui workspace-local config (theme + model preferences only).
 *   theme: catppuccin-mocha
 *   model:
 *     provider: deepseek      # partial override of the user's model prefs
 *     model: deepseek-chat
 *     reasoningEffort: high
 *
 * All fields optional; model subfields merge partially (a workspace that sets
 * only `provider` leaves the global `model` / `reasoningEffort` in effect).
 * Unknown keys are IGNORED on load and PRESERVED verbatim on save
 * (read-modify-write) — forward compatibility for future schema versions.
 * Managed keys follow "presence is authority": a key present in the overlay
 * (own property, even when `undefined`) is written/removed by
 * `saveWorkspaceConfig`; a key absent from the overlay is left untouched.
 *
 * Precedence (highest wins): environment (`DSH_OPENTUI_THEME`,
 * `DSH_OPENTUI_MODEL`) > workspace overlay > profile/global base.
 *
 * File format — a strict, fail-closed subset of YAML, parsed without
 * dependencies (the tree ships no yaml lib): nested block mappings of
 * scalars, `#` comments, blank lines, single leading `---`. NOT supported
 * (parse error with file:line): sequences, flow collections (`{}`/`[]`),
 * block scalars (`|`/`>`), anchors/aliases/tags, multi-line scalars,
 * tab indentation, duplicate keys, plain scalars containing `": "`.
 * `saveWorkspaceConfig` refuses to rewrite a malformed file (fail closed —
 * a blind rewrite would destroy the parts it cannot parse).
 *
 * Security posture:
 * - credential-shaped keys (`apiKey`, `token`, `secret`, … — denylist below)
 *   are rejected on BOTH load and save with a clear error; they never round-
 *   trip through the overlay;
 * - the file is written 0600 into a 0700 `.dsh/`, via a same-directory
 *   atomic rename (no torn config on crash);
 * - error messages carry paths, keys, and line numbers — never values read
 *   from credential-shaped fields.
 */

import {
	accessSync,
	chmodSync,
	constants,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Model preference override; every field optional (partial merge). */
export interface ModelPrefs {
	provider?: string
	model?: string
	reasoningEffort?: string
}

/**
 * The config slice the workspace layer touches: theme name + model
 * preferences. `mergeConfig(base)` accepts any base carrying at least this
 * slice (a profile/global `Config` in the client's own type may carry more —
 * fields outside this slice pass through untouched because merge only sees
 * what it declares).
 */
export interface Config {
	theme?: string
	model?: ModelPrefs
}

/**
 * One workspace's override file, loaded as a partial of {@link Config}.
 * Structurally identical to `Config`; a distinct name keeps call sites
 * honest about which side of the merge a value came from.
 */
export type WorkspaceOverlay = Config

/** Env var overriding the workspace theme (existing shell convention). */
export const ENV_THEME = "DSH_OPENTUI_THEME"
/** Env var overriding the workspace model route, as `provider/model` (or a bare model id). */
export const ENV_MODEL = "DSH_OPENTUI_MODEL"

const CONFIG_DIR = ".dsh"
const CONFIG_FILE = "config.yml"

/** Absolute path of the workspace config file: `<workspaceDir>/.dsh/config.yml`. */
export function workspaceConfigPath(workspaceDir: string): string {
	return join(workspaceDir, CONFIG_DIR, CONFIG_FILE)
}

/** Base class for every workspace-config failure. */
export class WorkspaceConfigError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "WorkspaceConfigError"
	}
}

/** The file violates the supported YAML subset (message carries `path:line`). */
export class WorkspaceConfigParseError extends WorkspaceConfigError {
	readonly path: string
	readonly line?: number

	constructor(path: string, line: number | undefined, reason: string) {
		super(`${path}${line === undefined ? "" : `:${line}`}: ${reason}`)
		this.name = "WorkspaceConfigParseError"
		this.path = path
		this.line = line
	}
}

/** A credential-shaped key was found where it must never live (VCS leak guard). */
export class WorkspaceConfigCredentialError extends WorkspaceConfigError {
	readonly keyPath: string

	constructor(keyPath: string, where: string) {
		super(
			`credential-like key "${keyPath}" in ${where} — workspace config must never hold credentials ` +
				"(the file lives next to the working tree and would leak into version control); remove it",
		)
		this.name = "WorkspaceConfigCredentialError"
		this.keyPath = keyPath
	}
}

/** The `.dsh/` directory or config file cannot be created/written (message is actionable). */
export class WorkspaceConfigWriteError extends WorkspaceConfigError {
	readonly path: string

	constructor(path: string, message: string) {
		super(`${path}: ${message}`)
		this.name = "WorkspaceConfigWriteError"
		this.path = path
	}
}

/**
 * Load `<workspaceDir>/.dsh/config.yml` as a workspace overlay.
 *
 * - missing workspace dir / missing file / empty or comment-only file → `{}`;
 * - malformed file → {@link WorkspaceConfigParseError} (path + line);
 * - credential-shaped keys → {@link WorkspaceConfigCredentialError}.
 *
 * Unknown keys are ignored in the returned overlay (they are preserved on
 * save, which re-reads the file itself).
 */
export async function loadWorkspaceConfig(workspaceDir: string): Promise<WorkspaceOverlay> {
	const path = workspaceConfigPath(workspaceDir)
	if (!existsSync(path)) return {}
	let text: string
	try {
		text = readFileSync(path, "utf8")
	} catch (error) {
		throw new WorkspaceConfigWriteError(path, `cannot read existing config (${(error as Error).message})`)
	}
	const tree = parseConfigDoc(text, path)
	assertNoCredentialKeys(tree, path)
	return overlayFromTree(tree, path)
}

/**
 * Merge base config, workspace overlay, and environment into one config.
 * Precedence per field (highest wins): `env` > `overlay` > `base`.
 *
 * Field-by-field rules:
 * - `theme`: `env[DSH_OPENTUI_THEME]` → `overlay.theme` → `base.theme`.
 * - `model.provider` / `model.model`: env `DSH_OPENTUI_MODEL` wins as a pair
 *   when written `provider/model` (split at the FIRST `/`; a trailing-slash
 *   or leading-slash form sets only the non-empty half). A bare value (no
 *   `/`) sets only `model.model` — provider falls through to overlay → base.
 * - `model.reasoningEffort`: overlay → base (no env var in v1).
 * - Every other base field is out of this module's scope and untouched.
 *
 * Empty strings count as unset at every layer, so an empty env var does not
 * mask lower layers. The result omits empty branches (no `model: {}`).
 * Pure function: reads nothing but its arguments; pass `process.env` at the
 * call site if the environment layer is wanted.
 */
export function mergeConfig(base: Config, overlay: WorkspaceOverlay, env?: Record<string, string>): Config {
	const envTheme = pickEnv(env, ENV_THEME)
	const envRoute = pickEnv(env, ENV_MODEL)
	let envProvider: string | undefined
	let envModel: string | undefined
	if (envRoute !== undefined) {
		const slash = envRoute.indexOf("/")
		if (slash === -1) {
			envModel = envRoute
		} else {
			envProvider = nonEmpty(envRoute.slice(0, slash))
			envModel = nonEmpty(envRoute.slice(slash + 1))
		}
	}

	const theme = envTheme ?? nonEmpty(overlay.theme) ?? nonEmpty(base.theme)
	const provider = envProvider ?? nonEmpty(overlay.model?.provider) ?? nonEmpty(base.model?.provider)
	const model = envModel ?? nonEmpty(overlay.model?.model) ?? nonEmpty(base.model?.model)
	const reasoningEffort = nonEmpty(overlay.model?.reasoningEffort) ?? nonEmpty(base.model?.reasoningEffort)

	const mergedModel: ModelPrefs | undefined =
		provider !== undefined || model !== undefined || reasoningEffort !== undefined
			? {
					...(provider !== undefined && { provider }),
					...(model !== undefined && { model }),
					...(reasoningEffort !== undefined && { reasoningEffort }),
				}
			: undefined
	return {
		...(theme !== undefined && { theme }),
		...(mergedModel !== undefined && { model: mergedModel }),
	}
}

/**
 * Write the overlay into `<workspaceDir>/.dsh/config.yml` (read-modify-write).
 *
 * - creates `.dsh/` (0700) and the workspace dir itself if needed;
 * - writes 0600 atomically (temp file + rename in the same directory);
 * - PRESERVES unknown keys already in the file, at every depth;
 * - managed keys follow "presence is authority": `theme` / `model` (and the
 *   model subfields `provider` / `model` / `reasoningEffort`) present as own
 *   properties of the overlay are written, or REMOVED when `undefined`;
 *   absent own properties are left untouched — a caller unaware of a field
 *   never destroys it;
 * - refuses to rewrite a malformed existing file ({@link WorkspaceConfigParseError});
 * - rejects credential-shaped keys — both in the overlay itself and among the
 *   file's preserved unknown keys — with {@link WorkspaceConfigCredentialError};
 * - unknown keys in the overlay (anything but `theme` / `model`) and non-string
 *   values are rejected.
 */
export async function saveWorkspaceConfig(workspaceDir: string, overlay: WorkspaceOverlay): Promise<void> {
	validateOverlayShape(overlay)

	const configDir = join(workspaceDir, CONFIG_DIR)
	const path = workspaceConfigPath(workspaceDir)
	ensureWritableDir(workspaceDir, configDir)

	// Read-modify-write: unknown keys survive via the raw tree.
	let tree: RawMap = mkMap(0)
	if (existsSync(path)) {
		let text: string
		try {
			text = readFileSync(path, "utf8")
		} catch (error) {
			throw new WorkspaceConfigWriteError(path, `cannot read existing config (${(error as Error).message})`)
		}
		tree = parseConfigDoc(text, path) // malformed → ParseError: refuse to clobber
	}
	applyOverlayToTree(tree, overlay)
	assertNoCredentialKeys(tree, path)

	const body = serializeTree(tree)
	const doc = FILE_HEADER + (body.length === 0 ? "" : body.join("\n") + "\n")
	atomicWrite(path, doc)
}

// ---------------------------------------------------------------------------
// Overlay validation + guards
// ---------------------------------------------------------------------------

/** Keys that must never appear in workspace config (normalized matching). */
const CREDENTIAL_KEY_DENYLIST: ReadonlySet<string> = new Set([
	"apikey",
	"apisecret",
	"token",
	"accesstoken",
	"refreshtoken",
	"idtoken",
	"sessiontoken",
	"secret",
	"secretkey",
	"clientsecret",
	"privatekey",
	"password",
	"passwd",
	"credential",
	"credentials",
	"auth",
	"authorization",
	"cookie",
	"bearer",
	"sessionkey",
	"signingkey",
])

/** Normalize a key the way people spell secrets: lowercased, `_`/`-`/spaces folded away. */
function isCredentialKey(key: string): boolean {
	return CREDENTIAL_KEY_DENYLIST.has(key.toLowerCase().replaceAll(/[ \t_-]+/gu, ""))
}

const MODEL_FIELDS = ["provider", "model", "reasoningEffort"] as const

/** Runtime shape check for JS callers; throws before anything touches the filesystem. */
function validateOverlayShape(overlay: WorkspaceOverlay): void {
	if (overlay === null || typeof overlay !== "object" || Array.isArray(overlay)) {
		throw new WorkspaceConfigError("workspace overlay must be an object")
	}
	for (const key of Object.keys(overlay)) {
		if (key === "theme" || key === "model") continue
		if (isCredentialKey(key)) throw new WorkspaceConfigCredentialError(key, "the workspace overlay")
		throw new WorkspaceConfigError(
			`unknown overlay key "${key}" — workspace config supports only theme and model preferences`,
		)
	}
	if (overlay.theme !== undefined && (!isNonEmptyString(overlay.theme))) {
		throw new WorkspaceConfigError('overlay.theme must be a non-empty string')
	}
	if (overlay.model !== undefined) {
		if (overlay.model === null || typeof overlay.model !== "object" || Array.isArray(overlay.model)) {
			throw new WorkspaceConfigError("overlay.model must be an object")
		}
		for (const key of Object.keys(overlay.model)) {
			if (!(MODEL_FIELDS as readonly string[]).includes(key)) {
				if (isCredentialKey(key)) throw new WorkspaceConfigCredentialError(`model.${key}`, "the workspace overlay")
				throw new WorkspaceConfigError(
					`unknown overlay key "model.${key}" — model supports only provider, model, reasoningEffort`,
				)
			}
		}
		for (const field of MODEL_FIELDS) {
			const value = overlay.model[field]
			if (value !== undefined && !isNonEmptyString(value)) {
				throw new WorkspaceConfigError(`overlay.model.${field} must be a non-empty string`)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// YAML subset parser (fail closed; the Host's own writer subset + maps of scalars)
// ---------------------------------------------------------------------------

interface RawScalar {
	kind: "scalar"
	/** Unquoted string value. */
	text: string
	/** The value as written (plain) or as re-quoted (quoted) — emitted verbatim on save. */
	raw: string
	/** True when the value was quoted in the file (re-quoted canonically on save). */
	quoted: boolean
	line: number
}

interface RawMap {
	kind: "map"
	/** Insertion-ordered; order is preserved on save. */
	entries: Map<string, RawNode>
	line: number
}

interface RawNull {
	kind: "null"
	line: number
}

type RawNode = RawScalar | RawMap | RawNull

interface Frame {
	map: RawMap
	/** Entry indentation of this map. */
	indent: number
	/** Key of the most recently added entry (nesting target). */
	lastKey?: string
}

/** Scalars YAML would type as null/bool/number — rejected for string fields, quoted on save. */
const ATOMIC_SCALAR =
	/^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|[-+]?(?:\d+|\d+\.\d+|\.\d+)(?:[eE][-+]?\d+)?|[-+]?(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/u

function mkMap(line: number): RawMap {
	return { kind: "map", entries: new Map(), line }
}

function mkScalar(text: string, line: number, quoted: boolean, raw?: string): RawScalar {
	return { kind: "scalar", text, quoted, raw: raw ?? (quoted ? doubleQuote(text) : text), line }
}

/** Parse the whole document into an ordered tree; throws WorkspaceConfigParseError. */
function parseConfigDoc(text: string, path: string): RawMap {
	const root = mkMap(0)
	const stack: Frame[] = [{ map: root, indent: 0 }]
	let sawContent = false
	const lines = text.replace(/^\uFEFF/u, "").split("\n")

	for (let i = 0; i < lines.length; i++) {
		const lineNo = i + 1
		const line = lines[i].replace(/\r$/u, "")
		const trimmed = line.trim()
		if (trimmed === "" || trimmed.startsWith("#")) continue
		if (trimmed === "---" && !sawContent) continue // document start marker
		if (trimmed === "---" || trimmed === "...") {
			throw new WorkspaceConfigParseError(path, lineNo, "document markers beyond a single leading `---` are not supported")
		}
		if (trimmed.startsWith("%")) {
			throw new WorkspaceConfigParseError(path, lineNo, "YAML directives are not supported")
		}
		sawContent = true
		if (/^ *\t/u.test(line)) {
			throw new WorkspaceConfigParseError(path, lineNo, "tab indentation is not supported — indent with spaces")
		}
		const indent = leadingSpaces(line)
		const rest = line.slice(indent)
		if (rest.startsWith("- ") || rest === "-") {
			throw new WorkspaceConfigParseError(path, lineNo, "sequences (lists) are not supported in workspace config")
		}

		const { key, valueText } = splitEntry(rest, path, lineNo)
		const node = parseValue(valueText, path, lineNo)
		attachEntry(stack, indent, key, node, path, lineNo)
	}
	return root
}

/** Split one content line into key + raw value text (undefined when a block follows). */
function splitEntry(rest: string, path: string, lineNo: number): { key: string; valueText: string | undefined } {
	const first = rest[0]
	if (first === "'" || first === '"') {
		const scanned = scanQuoted(rest, path, lineNo)
		let idx = scanned.end
		while (rest[idx] === " ") idx++
		if (rest[idx] !== ":") {
			throw new WorkspaceConfigParseError(path, lineNo, 'expected "key: value" — quoted key not followed by ":"')
		}
		const valueText = rest.slice(idx + 1).trim()
		return { key: scanned.text, valueText: valueText === "" ? undefined : valueText }
	}
	const colon = findKeyColon(rest)
	if (colon === -1) {
		throw new WorkspaceConfigParseError(path, lineNo, 'expected "key: value" (missing space after colon?)')
	}
	const key = rest.slice(0, colon).trim()
	if (!key) throw new WorkspaceConfigParseError(path, lineNo, "empty key")
	const valueText = rest.slice(colon + 1).trim()
	return { key, valueText: valueText === "" ? undefined : valueText }
}

/** First `:` that acts as a block-mapping separator (followed by space/tab or end of line). */
function findKeyColon(rest: string): number {
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] !== ":") continue
		const next = rest[i + 1]
		if (i + 1 === rest.length || next === " " || next === "\t") return i
	}
	return -1
}

/** Classify one raw value into a node; undefined means "block or null". */
function parseValue(valueText: string | undefined, path: string, lineNo: number): RawNode {
	if (valueText === undefined) return { kind: "null", line: lineNo }
	if (valueText.startsWith("#")) return { kind: "null", line: lineNo } // `key: # comment`
	const first = valueText[0]
	if (first === "|" || first === ">") {
		throw new WorkspaceConfigParseError(path, lineNo, "block scalars (| >) are not supported in workspace config")
	}
	if (first === "[" || first === "{") {
		throw new WorkspaceConfigParseError(path, lineNo, "flow collections ([] {}) are not supported in workspace config")
	}
	if (first === "&" || first === "*" || first === "!") {
		throw new WorkspaceConfigParseError(path, lineNo, "anchors, aliases, and tags are not supported in workspace config")
	}
	if (first === "'" || first === '"') {
		const scanned = scanQuoted(valueText, path, lineNo)
		let idx = scanned.end
		while (valueText[idx] === " ") idx++
		if (idx < valueText.length && valueText[idx] !== "#") {
			throw new WorkspaceConfigParseError(path, lineNo, "unexpected content after closing quote")
		}
		return mkScalar(scanned.text, lineNo, true)
	}
	// Plain scalar: strip a trailing ` # comment`, keep the raw text verbatim.
	const comment = valueText.indexOf(" #")
	const raw = (comment === -1 ? valueText : valueText.slice(0, comment)).trimEnd()
	if (raw === "") return { kind: "null", line: lineNo }
	if (raw.includes(": ")) {
		throw new WorkspaceConfigParseError(path, lineNo, `plain scalar cannot contain ": " — quote the value`)
	}
	return mkScalar(raw, lineNo, false, raw)
}

/** Scan a quoted scalar from index 0; supports `''` doubling and only `\"` / `\\` escapes. */
function scanQuoted(text: string, path: string, lineNo: number): { text: string; end: number } {
	const quote = text[0]
	let out = ""
	let i = 1
	while (i < text.length) {
		const ch = text[i]
		if (quote === "'") {
			if (ch === "'") {
				if (text[i + 1] === "'") {
					out += "'"
					i += 2
					continue
				}
				return { text: out, end: i + 1 }
			}
			out += ch
			i++
			continue
		}
		// double-quoted
		if (ch === "\\") {
			const esc = text[i + 1]
			if (esc === '"' || esc === "\\") {
				out += esc
				i += 2
				continue
			}
			throw new WorkspaceConfigParseError(path, lineNo, `unsupported escape "\\${esc ?? ""}" in double-quoted scalar`)
		}
		if (ch === '"') return { text: out, end: i + 1 }
		out += ch
		i++
	}
	throw new WorkspaceConfigParseError(path, lineNo, "unclosed quoted scalar")
}

/** Attach one parsed entry to the tree, enforcing indentation consistency. */
function attachEntry(stack: Frame[], indent: number, key: string, node: RawNode, path: string, lineNo: number): void {
	while (stack.length > 1 && stack[stack.length - 1].indent > indent) stack.pop()
	const frame = stack[stack.length - 1]

	if (frame.indent === indent) {
		if (frame.map.entries.has(key)) {
			throw new WorkspaceConfigParseError(path, lineNo, `duplicate key "${key}"`)
		}
		frame.map.entries.set(key, node)
		frame.lastKey = key
		return
	}

	// Deeper than the open frame: nest under the frame's last entry.
	if (frame.lastKey === undefined) {
		throw new WorkspaceConfigParseError(path, lineNo, "unexpected indentation (no parent key above)")
	}
	const parent = frame.map.entries.get(frame.lastKey)
	if (parent === undefined) throw new WorkspaceConfigParseError(path, lineNo, "unexpected indentation")
	if (parent.kind === "scalar") {
		throw new WorkspaceConfigParseError(path, lineNo, `unexpected indentation under scalar "${frame.lastKey}"`)
	}
	let map: RawMap
	if (parent.kind === "map") {
		// Unreachable while frames track open maps; kept as a defensive fail-closed check.
		throw new WorkspaceConfigParseError(path, lineNo, "inconsistent indentation")
	}
	map = mkMap(lineNo)
	frame.map.entries.set(frame.lastKey, map)
	stack.push({ map, indent, lastKey: undefined })
	if (map.entries.has(key)) throw new WorkspaceConfigParseError(path, lineNo, `duplicate key "${key}"`)
	map.entries.set(key, node)
}

function leadingSpaces(line: string): number {
	let n = 0
	while (n < line.length && line[n] === " ") n++
	return n
}

// ---------------------------------------------------------------------------
// Overlay extraction (load) + tree application (save)
// ---------------------------------------------------------------------------

/** Extract the known fields from the tree; unknown keys are skipped. */
function overlayFromTree(tree: RawMap, path: string): WorkspaceOverlay {
	const overlay: WorkspaceOverlay = {}
	const theme = tree.entries.get("theme")
	if (theme !== undefined) overlay.theme = readStringField(tree, "theme", path)
	const model = tree.entries.get("model")
	if (model !== undefined) {
		if (model.kind !== "map") {
			throw new WorkspaceConfigParseError(path, model.line, '"model" must be a block of provider/model/reasoningEffort')
		}
		const prefs: ModelPrefs = {}
		for (const field of MODEL_FIELDS) {
			const entry = model.entries.get(field)
			if (entry !== undefined) prefs[field] = readStringField(model, field, path)
		}
		if (prefs.provider !== undefined || prefs.model !== undefined || prefs.reasoningEffort !== undefined) {
			overlay.model = prefs
		}
	}
	return overlay
}

/** Read one known string field; fails closed on wrong shape/type with the field's line. */
function readStringField(parent: RawMap, key: string, path: string): string {
	const node = parent.entries.get(key)
	if (node === undefined) throw new WorkspaceConfigParseError(path, parent.line, `"${key}" disappeared mid-read`)
	if (node.kind === "null") throw new WorkspaceConfigParseError(path, node.line, `"${key}" must be a string value`)
	if (node.kind === "map") {
		throw new WorkspaceConfigParseError(path, node.line, `"${key}" must be a string value, got a nested block`)
	}
	if (!node.quoted && ATOMIC_SCALAR.test(node.text)) {
		throw new WorkspaceConfigParseError(path, node.line, `"${key}" must be a quoted string (bare value reads as non-string)`)
	}
	if (node.text.trim() === "") throw new WorkspaceConfigParseError(path, node.line, `"${key}" must be a non-empty string`)
	return node.text
}

/** Apply the overlay to the tree; "presence is authority" (see module docs). */
function applyOverlayToTree(tree: RawMap, overlay: WorkspaceOverlay): void {
	if (Object.hasOwn(overlay, "theme")) {
		if (overlay.theme === undefined) tree.entries.delete("theme")
		else tree.entries.set("theme", mkScalar(overlay.theme, 0, needsQuote(overlay.theme)))
	}
	if (!Object.hasOwn(overlay, "model")) return
	if (overlay.model === undefined) {
		tree.entries.delete("model")
		return
	}
	const existing = tree.entries.get("model")
	const block = existing !== undefined && existing.kind === "map" ? existing : mkMap(existing?.line ?? 0)
	tree.entries.set("model", block) // keeps insertion position when replacing in place
	for (const field of MODEL_FIELDS) {
		if (!Object.hasOwn(overlay.model, field)) continue
		const value = overlay.model[field]
		if (value === undefined) block.entries.delete(field)
		else block.entries.set(field, mkScalar(value, 0, needsQuote(value)))
	}
	if (block.entries.size === 0) tree.entries.delete("model")
}

/** Reject credential-shaped keys anywhere in the tree (all depths, keys only). */
function assertNoCredentialKeys(tree: RawMap, path: string): void {
	const visit = (map: RawMap, prefix: string): void => {
		for (const [key, node] of map.entries) {
			const keyPath = prefix === "" ? key : `${prefix}.${key}`
			if (isCredentialKey(key)) throw new WorkspaceConfigCredentialError(keyPath, path)
			if (node.kind === "map") visit(node, keyPath)
		}
	}
	visit(tree, "")
}

// ---------------------------------------------------------------------------
// Serializer (round-trip stable: plain scalars re-emitted verbatim, order kept)
// ---------------------------------------------------------------------------

const FILE_HEADER =
	"# dsh-opentui workspace-local config — theme + model preferences ONLY.\n" +
	"# Credentials and plugin installs must NEVER live in this file (it would\n" +
	"# leak into version control). Unknown keys are preserved on rewrite.\n"

function serializeTree(tree: RawMap): string[] {
	const out: string[] = []
	emitMap(tree, 0, out)
	return out
}

function emitMap(map: RawMap, indent: number, out: string[]): void {
	const pad = " ".repeat(indent)
	for (const [key, node] of map.entries) {
		const keyText = needsQuote(key) ? doubleQuote(key) : key
		if (node.kind === "null" || (node.kind === "map" && node.entries.size === 0)) {
			out.push(`${pad}${keyText}:`)
			if (node.kind === "map") emitMap(node, indent + 2, out)
			continue
		}
		if (node.kind === "scalar") {
			out.push(`${pad}${keyText}: ${node.quoted ? doubleQuote(node.text) : node.raw}`)
			continue
		}
		out.push(`${pad}${keyText}:`)
		emitMap(node, indent + 2, out)
	}
}

/** True when a plain (unquoted) emission would change the value's YAML type or shape. */
function needsQuote(text: string): boolean {
	if (text === "") return true
	if (text !== text.trim()) return true
	if (/[\t\r\n]/u.test(text)) return true
	if (text.includes(" #")) return true
	if (text.includes(": ")) return true
	if (text.endsWith(":")) return true
	if (ATOMIC_SCALAR.test(text)) return true
	const first = text[0]
	if ("#&*!|>'\"%@`,[]{}".includes(first)) return true
	if (first === "-" || first === "?") return text.length === 1 || text[1] === " "
	return false
}

function doubleQuote(text: string): string {
	return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

/** Atomic 0600 write: temp file in the same directory, then rename. */
function atomicWrite(path: string, doc: string): void {
	const tmp = `${path}.${process.pid}.tmp`
	const fail = (message: string): WorkspaceConfigWriteError => new WorkspaceConfigWriteError(path, message)
	try {
		writeFileSync(tmp, doc, { mode: 0o600 })
	} catch (error) {
		sweepTmp(tmp)
		throw fail(`cannot write config (${(error as Error).message}) — check disk space and directory permissions`)
	}
	try {
		renameSync(tmp, path)
	} catch (error) {
		sweepTmp(tmp)
		throw fail(`cannot replace config (${(error as Error).message})`)
	}
	try {
		chmodSync(path, 0o600)
	} catch (error) {
		throw fail(`cannot enforce 0600 permissions (${(error as Error).message})`)
	}
}

function sweepTmp(tmp: string): void {
	try {
		unlinkSync(tmp)
	} catch {
		/* nothing to sweep */
	}
}

/** Create/verify `.dsh/` with actionable errors for every failure mode. */
function ensureWritableDir(workspaceDir: string, configDir: string): void {
	const fail = (message: string): WorkspaceConfigWriteError => new WorkspaceConfigWriteError(configDir, message)
	if (!existsSync(workspaceDir) || !statSync(workspaceDir).isDirectory()) {
		throw new WorkspaceConfigWriteError(
			workspaceDir,
			"workspace directory does not exist or is not a directory — the workspace is the directory the TUI is launched in",
		)
	}
	if (existsSync(configDir)) {
		if (!statSync(configDir).isDirectory()) {
			throw fail("exists but is not a directory — remove or rename it")
		}
	} else {
		try {
			mkdirSync(configDir, { recursive: true, mode: 0o700 })
		} catch (error) {
			throw fail(`cannot create directory (${(error as Error).message}) — create it manually or check parent permissions`)
		}
	}
	try {
		accessSync(configDir, constants.W_OK)
	} catch {
		throw fail("is not writable — fix permissions (chmod u+w) or run from a writable workspace")
	}
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== ""
}

/** An env value only counts when non-blank; blanks fall through to lower layers. */
function pickEnv(env: Record<string, string> | undefined, name: string): string | undefined {
	const value = env?.[name]
	return nonEmpty(value)
}

function nonEmpty(value: string | undefined): string | undefined {
	return value !== undefined && value.trim() !== "" ? value : undefined
}
