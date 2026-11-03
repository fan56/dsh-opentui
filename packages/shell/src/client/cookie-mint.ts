/**
 * Mint a Host API cookie from the persisted `client-connection/browser-session`
 * grant secret in `$DSH_HOME/.credentials.yaml`.
 *
 * Reproduces the Host's own cookie recipe (dsh-client-connection BrowserAuth /
 * dsh-credentials) byte-for-byte — verified against a live host by the H1
 * token spike (cookie accepted on HTTP GET, on the mux WebSocket upgrade, and
 * on unary RPC):
 *
 *   secret      = records["client-connection/browser-session"].payload.secret
 *                 (43-char base64url encoding a 32-byte HMAC key)
 *   cookie name = "dsh-auth-" + base64url(sha256(authority))
 *   body        = base64url(JSON { version: 1, authority, issuedAt, expiresAt })
 *   value       = `v1.${body}.${base64url(HMAC-SHA256(secret, body))}`
 *
 * `authority` is the HTTP audience `host:port` (scheme omitted) exactly as the
 * Host binds it. HTTPS audiences additionally carry the `https:` scheme inside
 * the signed payload — not supported here (v1 client mode is a local HTTP
 * listener; see ADR-0005).
 *
 * Security posture:
 * - the credentials file must be owner-only (0600); anything wider refuses to
 *   mint (fail closed);
 * - neither the secret nor any cookie material ever appears in a thrown
 *   error message — errors carry only paths, record keys, and shape reasons;
 * - the record's first-boot creation is retried (the Host writes the grant
 *   during connection activation, which can race a fast client start);
 * - missing and shape-invalid grants raise distinct typed errors so the
 *   caller can decide to re-mint or surface a configuration problem.
 *
 * The file reader is a targeted subset parser for the flat schema the Host
 * writes (`version`, `records`, one grant record with `kind`/`payload`), not a
 * general YAML implementation. Sibling records are skipped by indentation
 * scoping; anything unexpected inside the target record fails closed with a
 * typed error and the strict secret pattern re-validates whatever was read.
 */

import { createHash, createHmac } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** The credentials record that holds the browser/API session signing secret. */
const RECORD_KEY = "client-connection/browser-session"
/** Host default `cookieMaxAgeDays`; larger lifetimes are clamped to it. */
const DEFAULT_MAX_AGE_MS = 30 * 86_400_000
/** First-boot retry cadence: the Host writes the grant during activation. */
const RETRY_INTERVAL_MS = 100
const RETRY_WINDOW_MS = 2000
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface MintOwnerCookieOptions {
	/** Host home directory (the `$DSH_HOME` that holds `.credentials.yaml`). */
	home: string
	/** Cookie audience bound into name and payload: `host:port` (no scheme). */
	authority: string
	/** Cookie lifetime; clamped to the Host's 30-day default window. */
	maxAgeMs?: number
}

/** Base class for every mint failure; messages are always secret-free. */
export class OwnerCookieError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "OwnerCookieError"
	}
}

/** `.credentials.yaml` absent (or unreadable) past the first-boot retry window. */
export class CredentialsFileMissingError extends OwnerCookieError {}
/** The `client-connection/browser-session` grant record is absent past the window. */
export class CredentialsGrantMissingError extends OwnerCookieError {}
/** The grant exists but its shape is wrong (rotated format, corrupt write, host upgrade). */
export class CredentialsGrantInvalidError extends OwnerCookieError {}
/** The credentials file is readable by group/other; minting refuses to proceed. */
export class CredentialsFileInsecureError extends OwnerCookieError {}
/** The file violates the credentials YAML subset the Host writes. */
export class CredentialsParseError extends OwnerCookieError {}

/** Deterministic cookie name for one authority: `dsh-auth-` + base64url(sha256). */
export function ownerCookieName(authority: string): string {
	return "dsh-auth-" + base64url(createHash("sha256").update(authority).digest())
}

/**
 * Mint the API cookie for one authority from the host home's persisted grant.
 * @returns the full `Cookie` header value: `<name>=<value>`.
 */
export function mintOwnerCookie(options: MintOwnerCookieOptions): string {
	const authority = options.authority
	if (typeof authority !== "string" || authority.length === 0 || /[\r\n/]/.test(authority)) {
		throw new OwnerCookieError("authority must be a non-empty host:port without scheme or path separators")
	}
	const secret = readGrantSecret(options.home)
	const issuedAt = Date.now()
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
	const expiresAt = issuedAt + Math.min(maxAgeMs, DEFAULT_MAX_AGE_MS)
	const body = base64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), "utf8"))
	const signature = base64url(createHmac("sha256", secret).update(body).digest())
	return `${ownerCookieName(authority)}=v1.${body}.${signature}`
}

/** Read + validate the grant secret from `<home>/.credentials.yaml` (with first-boot retries). */
function readGrantSecret(home: string): Buffer {
	const path = join(home, ".credentials.yaml")
	const deadline = Date.now() + RETRY_WINDOW_MS
	let sawFile = false
	while (true) {
		let file = ""
		try {
			assertOwnerOnly(path)
			file = readFileSync(path, "utf8")
			sawFile = true
		} catch (error) {
			if (error instanceof CredentialsFileInsecureError) throw error
			sawFile = false
		}
		if (sawFile) {
			const secret = extractSecret(file, path)
			if (secret !== undefined) return decodeSecret(secret, path)
		}
		if (Date.now() >= deadline) {
			if (!sawFile) {
				throw new CredentialsFileMissingError(
					`no credentials file at ${path} within ${RETRY_WINDOW_MS}ms (host first boot still pending?)`,
				)
			}
			throw new CredentialsGrantMissingError(
				`credentials record "${RECORD_KEY}" absent in ${path} within ${RETRY_WINDOW_MS}ms (host first boot still pending?)`,
			)
		}
		sleepSync(RETRY_INTERVAL_MS)
	}
}

/** Refuse to read credentials that group/other can read (must be 0600 or stricter). */
function assertOwnerOnly(path: string): void {
	let mode: number
	try {
		mode = statSync(path).mode
	} catch {
		return // absent → retryable, not a permissions fault
	}
	if ((mode & 0o077) !== 0) {
		throw new CredentialsFileInsecureError(
			`credentials file ${path} is group/other accessible (mode ${mode.toString(8)}); refusing to mint — chmod 600 required`,
		)
	}
}

/**
 * Pull `records.<RECORD_KEY>.{kind, payload.version, payload.secret}` out of
 * the credentials file. Indentation is discovered dynamically (the Host's
 * writer nests by two spaces today). Returns undefined when the record (or
 * `records`) is absent — a retryable first-boot condition. Any malformed
 * content inside the target record raises (fail closed).
 */
function extractSecret(file: string, path: string): string | undefined {
	const lines = file.split("\n")
	const recordsLine = findBlockLine(lines, "records", 0)
	if (recordsLine === -1) return undefined
	const childIndent = nextChildIndent(lines, recordsLine)
	if (childIndent === -1) return undefined
	const recordLine = findBlockLine(lines, RECORD_KEY, childIndent, recordsLine + 1)
	if (recordLine === -1) return undefined
	const recordIndent = nextChildIndent(lines, recordLine)
	if (recordIndent === -1) {
		throw new CredentialsGrantInvalidError(`credentials record "${RECORD_KEY}" in ${path} has no kind field`)
	}
	const kind = readScalarLine(lines, "kind", recordIndent, recordLine + 1)
	if (kind !== "grant") {
		throw new CredentialsGrantInvalidError(
			`credentials record "${RECORD_KEY}" in ${path} has ${kind === undefined ? "no kind field" : `kind other than "grant"`}`,
		)
	}
	const payloadLine = findBlockLine(lines, "payload", recordIndent, recordLine + 1)
	if (payloadLine === -1) {
		throw new CredentialsGrantInvalidError(`credentials record "${RECORD_KEY}" in ${path} has no payload block`)
	}
	const payloadIndent = nextChildIndent(lines, payloadLine)
	if (payloadIndent === -1) {
		throw new CredentialsGrantInvalidError(`credentials record "${RECORD_KEY}" in ${path} has an empty payload block`)
	}
	const payloadVersion = readScalarLine(lines, "version", payloadIndent, payloadLine + 1)
	if (payloadVersion !== "1") {
		throw new CredentialsGrantInvalidError(
			`credentials record "${RECORD_KEY}" in ${path} has payload.version ${payloadVersion === undefined ? "absent" : "other than 1"} (rotated grant format)`,
		)
	}
	const secret = readScalarLine(lines, "secret", payloadIndent, payloadLine + 1)
	if (secret === undefined) {
		throw new CredentialsGrantInvalidError(`credentials record "${RECORD_KEY}" in ${path} has no payload.secret`)
	}
	return secret
}

/** First line index of a block entry `key:` at exactly `atIndent`, scanning from `from`. */
function findBlockLine(lines: string[], key: string, atIndent: number, from = 0): number {
	const range = blockRange(lines, from, atIndent)
	for (let i = range.start; i < range.end; i++) {
		const entry = parseEntryLine(lines[i])
		if (entry && entry.indent === atIndent && entry.key === key && entry.value === undefined) return i
	}
	return -1
}

/** Scalar value of `key:` at exactly `atIndent` inside the block scanned from `from`. */
function readScalarLine(lines: string[], key: string, atIndent: number, from: number): string | undefined {
	const range = blockRange(lines, from, atIndent)
	for (let i = range.start; i < range.end; i++) {
		const entry = parseEntryLine(lines[i])
		if (entry && entry.indent === atIndent && entry.key === key) {
			if (entry.value === undefined) {
				throw new CredentialsParseError(`credentials file has a nested block where the "${key}" scalar is required`)
			}
			return entry.value
		}
	}
	return undefined
}

/**
 * Line range [start, end) of one indentation block at `atIndent`, scanning
 * from `from`: every non-empty line until the first dedent below `atIndent`
 * (a top-level block therefore spans the whole document).
 */
function blockRange(lines: string[], from: number, atIndent: number): { start: number; end: number } {
	let start = -1
	let i = from
	for (; i < lines.length; i++) {
		const line = lines[i]
		if (!line.trim() || line.trimStart().startsWith("#")) continue
		if (leadingSpaces(line) < atIndent) break
		if (start === -1) start = i
	}
	return { start: start === -1 ? lines.length : start, end: i }
}

/** Indentation of the first content line after `entryLine`, or -1 when the block is empty. */
function nextChildIndent(lines: string[], entryLine: number): number {
	const parentIndent = leadingSpaces(lines[entryLine])
	for (let i = entryLine + 1; i < lines.length; i++) {
		const line = lines[i]
		if (!line.trim() || line.trimStart().startsWith("#")) continue
		const indent = leadingSpaces(line)
		return indent > parentIndent ? indent : -1
	}
	return -1
}

function leadingSpaces(line: string): number {
	let n = 0
	while (n < line.length && line[n] === " ") n++
	return n
}

interface EntryLine {
	indent: number
	key: string
	/** undefined when the line is `key:` (block value follows). */
	value?: string
}

/** Parse one `key: value` line; undefined for blanks, comments, and unparsable lines. */
function parseEntryLine(line: string): EntryLine | undefined {
	const trimmed = line.trim()
	if (!trimmed || trimmed.startsWith("#")) return undefined
	if (line.includes("\t")) return undefined // tabs never appear in the Host's writer
	const indent = leadingSpaces(line)
	const rest = line.slice(indent)
	const colon = rest.indexOf(":")
	if (colon === -1) return undefined
	const key = unquote(rest.slice(0, colon).trim())
	if (!key) return undefined
	const rawValue = rest.slice(colon + 1).trim()
	if (rawValue === "" || rawValue.startsWith("#")) return { indent, key }
	return { indent, key, value: unquoteScalar(rawValue) }
}

function unquote(text: string): string {
	if (text.length >= 2) {
		if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'")
		if (text.startsWith('"') && text.endsWith('"')) return unescapeDoubleQuoted(text.slice(1, -1))
	}
	return text
}

/** Plain scalars drop a trailing ` # comment`; quoted scalars unescape minimally. */
function unquoteScalar(rawValue: string): string {
	if (rawValue.startsWith("'") || rawValue.startsWith('"')) return unquote(rawValue)
	const comment = rawValue.indexOf(" #")
	return (comment === -1 ? rawValue : rawValue.slice(0, comment)).trim()
}

function unescapeDoubleQuoted(text: string): string {
	return text.replaceAll('\\"', '"').replaceAll("\\\\", "\\")
}

/** Validate the 43-char base64url secret shape and decode it to the 32-byte key. */
function decodeSecret(secret: string, path: string): Buffer {
	if (!SECRET_PATTERN.test(secret)) {
		throw new CredentialsGrantInvalidError(
			`credentials record "${RECORD_KEY}" in ${path} has a secret that is not a 43-char base64url string (rotated grant format)`,
		)
	}
	const key = Buffer.from(secret.replaceAll("-", "+").replaceAll("_", "/") + "=", "base64")
	if (key.length !== 32) {
		throw new CredentialsGrantInvalidError(
			`credentials record "${RECORD_KEY}" in ${path} decodes to ${String(key.length)} bytes, expected 32`,
		)
	}
	return key
}

function base64url(buffer: Buffer): string {
	return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

function sleepSync(ms: number): void {
	// Atomics.wait parks the (contractually synchronous) mint without a busy
	// loop; the spin fallback covers runtimes that disallow Atomics.wait.
	const buffer = new Int32Array(new SharedArrayBuffer(4))
	const parked = (() => {
		try {
			return Atomics.wait(buffer, 0, 0, ms) === "timed-out"
		} catch {
			return false
		}
	})()
	if (!parked) {
		const until = Date.now() + ms
		while (Date.now() < until) {}
	}
}
