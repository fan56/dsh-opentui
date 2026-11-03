// cookie-mint contract tests against a FAKE credentials file in a tmp dir.
//
// Coverage: happy path (byte-exact recipe vs independently recomputed HMAC),
// first-boot retry-read, missing record / missing file, rotated + corrupt
// grant shapes, file-permission fail-closed, authority binding, secret
// rotation re-read, expiry clamping, sibling-record isolation — and a
// secret-leakage scan across every thrown message (nothing minted ever
// appears in an error).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	CredentialsFileInsecureError,
	CredentialsFileMissingError,
	CredentialsGrantInvalidError,
	CredentialsGrantMissingError,
	mintOwnerCookie,
	ownerCookieName,
} from "../src/client/cookie-mint.ts"

const SECRET_A = "aK3_xY9e2QvR7mLpT1wZ8hFd5sGjU0nBc4Vi6XyMqAo" // 43-char base64url
const SECRET_B = "Zz9_Lm2Kv8Qw4Xt7Rh5Nc1Jd6Pg3Sb0FyHuEaTrWkOs" // 43-char base64url
const AUTHORITY = "127.0.0.1:18110"
const RECORD = "client-connection/browser-session"

let home: string

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "dsh-cookie-mint-"))
})

afterEach(() => {
	rmSync(home, { recursive: true, force: true })
})

/** The exact YAML shape the dsh host writes on first boot. */
function writeCredentials(secret: string, opts?: { mode?: number; sibling?: string; quoted?: boolean }): string {
	const value = opts?.quoted ? `"${secret}"` : secret
	const sibling = opts?.sibling ? `${opts.sibling}\n` : ""
	const file = [
		"version: 1",
		"records:",
		`${sibling}  ${RECORD}:`,
		"    kind: grant",
		"    payload:",
		"      version: 1",
		`      secret: ${value}`,
		"",
	].join("\n")
	const path = join(home, ".credentials.yaml")
	writeFileSync(path, file)
	chmodSync(path, opts?.mode ?? 0o600)
	return path
}

function decodeBase64url(text: string): Buffer {
	return Buffer.from(text.replaceAll("-", "+").replaceAll("/", "_") + "=", "base64")
}

/** Independently recompute the expected cookie per the host's documented recipe. */
function expectedCookie(secret: string, authority: string, issuedAt: number, expiresAt: number): { name: string; body: string; value: string } {
	const key = decodeBase64url(secret)
	const body = Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), "utf8")
		.toString("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "")
	const sig = createHmac("sha256", key).update(body).digest().toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
	const name = "dsh-auth-" + createHash("sha256").update(authority).digest().toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
	return { name, body, value: `v1.${body}.${sig}` }
}

function credentialsAbsentError(error: unknown): error is CredentialsFileMissingError {
	return error instanceof CredentialsFileMissingError
}

describe("mintOwnerCookie happy path", () => {
	test("mints a byte-exact cookie per the host recipe", () => {
		writeCredentials(SECRET_A)
		const before = Date.now()
		const cookie = mintOwnerCookie({ home, authority: AUTHORITY })
		const after = Date.now()

		const eq = cookie.indexOf("=")
		const name = cookie.slice(0, eq)
		const value = cookie.slice(eq + 1)
		expect(name).toBe(ownerCookieName(AUTHORITY))

		const parts = value.split(".")
		expect(parts).toHaveLength(3)
		expect(parts[0]).toBe("v1")

		const payload = JSON.parse(new TextDecoder().decode(decodeBase64url(parts[1]))) as {
			version: number
			authority: string
			issuedAt: number
			expiresAt: number
		}
		expect(payload.version).toBe(1)
		expect(payload.authority).toBe(AUTHORITY)
		expect(payload.issuedAt).toBeGreaterThanOrEqual(before)
		expect(payload.issuedAt).toBeLessThanOrEqual(after)
		// default lifetime = the host's 30-day cookieMaxAgeDays window
		expect(payload.expiresAt - payload.issuedAt).toBe(30 * 86_400_000)

		// HMAC binds exactly the middle segment (body = the b64url string itself)
		const key = decodeBase64url(SECRET_A)
		const sig = createHmac("sha256", key).update(parts[1]).digest().toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
		expect(parts[2]).toBe(sig)

		// matches the fully independent recomputation (fixed timestamps)
		const fixed = expectedCookie(SECRET_A, AUTHORITY, payload.issuedAt, payload.expiresAt)
		expect(`${fixed.name}=${fixed.value}`).toBe(cookie)
	})

	test("never leaks the secret through the minted header", () => {
		writeCredentials(SECRET_A)
		const cookie = mintOwnerCookie({ home, authority: AUTHORITY })
		expect(cookie.includes(SECRET_A)).toBe(false)
	})

	test("honours maxAgeMs and clamps beyond the host's 30-day window", () => {
		writeCredentials(SECRET_A)
		const short = mintOwnerCookie({ home, authority: AUTHORITY, maxAgeMs: 3_600_000 })
		const shortPayload = JSON.parse(new TextDecoder().decode(decodeBase64url(short.split(".")[1]))) as { expiresAt: number; issuedAt: number }
		expect(shortPayload.expiresAt - shortPayload.issuedAt).toBe(3_600_000)

		const huge = mintOwnerCookie({ home, authority: AUTHORITY, maxAgeMs: 90 * 86_400_000 })
		const hugePayload = JSON.parse(new TextDecoder().decode(decodeBase64url(huge.split(".")[1]))) as { expiresAt: number; issuedAt: number }
		expect(hugePayload.expiresAt - hugePayload.issuedAt).toBe(30 * 86_400_000)
	})

	test("accepts a quoted secret scalar (defensive writer variation)", () => {
		writeCredentials(SECRET_A, { quoted: true })
		const cookie = mintOwnerCookie({ home, authority: AUTHORITY })
		const parts = cookie.split("=")[1].split(".")
		const key = decodeBase64url(SECRET_A)
		const sig = createHmac("sha256", key).update(parts[1]).digest().toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
		expect(parts[2]).toBe(sig)
	})

	test("isolates the target record from sibling records with confusing shapes", () => {
		writeCredentials(SECRET_A, {
			sibling: "  other/thing:\n    kind: grant\n    payload:\n      version: 9\n      deeper:\n        secret: sibling_secret_never_read_000000000000000",
		})
		const cookie = mintOwnerCookie({ home, authority: AUTHORITY })
		const parts = cookie.split("=")[1].split(".")
		const key = decodeBase64url(SECRET_A)
		const sig = createHmac("sha256", key).update(parts[1]).digest().toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
		expect(parts[2]).toBe(sig)
	})
})

describe("authority binding", () => {
	test("cookie name and payload bind the exact authority", () => {
		writeCredentials(SECRET_A)
		const a = mintOwnerCookie({ home, authority: "127.0.0.1:18110" })
		const b = mintOwnerCookie({ home, authority: "127.0.0.1:18111" })
		expect(a.split("=")[0]).toBe(ownerCookieName("127.0.0.1:18110"))
		expect(b.split("=")[0]).toBe(ownerCookieName("127.0.0.1:18111"))
		expect(a.split("=")[0]).not.toBe(b.split("=")[0])
		const payloadA = JSON.parse(new TextDecoder().decode(decodeBase64url(a.split(".")[1]))) as { authority: string }
		const payloadB = JSON.parse(new TextDecoder().decode(decodeBase64url(b.split(".")[1]))) as { authority: string }
		expect(payloadA.authority).toBe("127.0.0.1:18110")
		expect(payloadB.authority).toBe("127.0.0.1:18111")
	})

	test("rejects authorities that carry a scheme or separators", () => {
		writeCredentials(SECRET_A)
		for (const bad of ["http://127.0.0.1:1", "", "127.0.0.1:1/path", "a\r\nb"]) {
			expect(() => mintOwnerCookie({ home, authority: bad })).toThrow(/authority/)
		}
	})
})

describe("rotation and re-read", () => {
	test("re-reads the file: a rotated secret mints a different cookie", () => {
		writeCredentials(SECRET_A)
		const first = mintOwnerCookie({ home, authority: AUTHORITY })
		// host rotated the grant: the record was replaced wholesale
		writeCredentials(SECRET_B)
		const second = mintOwnerCookie({ home, authority: AUTHORITY })
		expect(first).not.toBe(second)
		const sigA = createHmac("sha256", decodeBase64url(SECRET_A)).update(second.split(".")[1]).digest().toString("base64")
		expect(second.split(".")[2]).not.toBe(sigA.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, ""))
	})
})

describe("missing / invalid grants", () => {
	test("missing file: retries then raises the typed missing-file error (~2s)", async () => {
		const start = Date.now()
		try {
			mintOwnerCookie({ home, authority: AUTHORITY })
			throw new Error("expected CredentialsFileMissingError")
		} catch (error) {
			expect(credentialsAbsentError(error)).toBe(true)
			expect(Date.now() - start).toBeGreaterThanOrEqual(2000)
		}
	})

	test("missing record: retries then raises the typed missing-grant error (~2s)", () => {
		writeCredentials(SECRET_A)
		// rewrite without the record
		writeFileSync(join(home, ".credentials.yaml"), "version: 1\nrecords: {}\n")
		chmodSync(join(home, ".credentials.yaml"), 0o600)
		const start = Date.now()
		try {
			mintOwnerCookie({ home, authority: AUTHORITY })
			throw new Error("expected CredentialsGrantMissingError")
		} catch (error) {
			expect(error).toBeInstanceOf(CredentialsGrantMissingError)
			expect(Date.now() - start).toBeGreaterThanOrEqual(2000)
		}
	})

	test("wrong kind is an immediate invalid-grant error", () => {
		writeCredentials(SECRET_A)
		const path = join(home, ".credentials.yaml")
		writeFileSync(path, `version: 1\nrecords:\n  ${RECORD}:\n    kind: token\n    payload:\n      version: 1\n      secret: ${SECRET_A}\n`)
		chmodSync(path, 0o600)
		try {
			mintOwnerCookie({ home, authority: AUTHORITY })
			throw new Error("expected CredentialsGrantInvalidError")
		} catch (error) {
			expect(error).toBeInstanceOf(CredentialsGrantInvalidError)
			expect((error as Error).message).toContain("kind")
		}
	})

	test("rotated payload version is an immediate invalid-grant error", () => {
		writeCredentials(SECRET_A)
		const path = join(home, ".credentials.yaml")
		writeFileSync(path, `version: 1\nrecords:\n  ${RECORD}:\n    kind: grant\n    payload:\n      version: 2\n      secret: ${SECRET_A}\n`)
		chmodSync(path, 0o600)
		try {
			mintOwnerCookie({ home, authority: AUTHORITY })
			throw new Error("expected CredentialsGrantInvalidError")
		} catch (error) {
			expect(error).toBeInstanceOf(CredentialsGrantInvalidError)
			expect((error as Error).message).toContain("payload.version")
		}
	})

	test("short secret is an immediate invalid-grant error", () => {
		writeCredentials("too-short")
		try {
			mintOwnerCookie({ home, authority: AUTHORITY })
			throw new Error("expected CredentialsGrantInvalidError")
		} catch (error) {
			expect(error).toBeInstanceOf(CredentialsGrantInvalidError)
			expect((error as Error).message).toContain("43-char base64url")
		}
	})

	test("group/other-readable credentials file refuses to mint (fail closed)", () => {
		writeCredentials(SECRET_A, { mode: 0o644 })
		try {
			mintOwnerCookie({ home, authority: AUTHORITY })
			throw new Error("expected CredentialsFileInsecureError")
		} catch (error) {
			expect(error).toBeInstanceOf(CredentialsFileInsecureError)
			expect((error as Error).message).toContain("600")
		}
	})
})

describe("no secret leakage in errors", () => {
	const probes: { name: string; setup: () => void }[] = [
		{ name: "missing file", setup: () => {} },
		{
			name: "missing record",
			setup: () => {
				writeFileSync(join(home, ".credentials.yaml"), "version: 1\nrecords: {}\n")
				chmodSync(join(home, ".credentials.yaml"), 0o600)
			},
		},
		{
			name: "wrong kind",
			setup: () => {
				const path = join(home, ".credentials.yaml")
				writeFileSync(path, `version: 1\nrecords:\n  ${RECORD}:\n    kind: token\n    payload:\n      version: 1\n      secret: ${SECRET_A}\n`)
				chmodSync(path, 0o600)
			},
		},
		{
			name: "rotated version",
			setup: () => {
				const path = join(home, ".credentials.yaml")
				writeFileSync(path, `version: 1\nrecords:\n  ${RECORD}:\n    kind: grant\n    payload:\n      version: 2\n      secret: ${SECRET_A}\n`)
				chmodSync(path, 0o600)
			},
		},
		{
			name: "short secret",
			setup: () => writeCredentials("too-short"),
		},
		{
			name: "insecure file",
			setup: () => writeCredentials(SECRET_A, { mode: 0o666 }),
		},
	]

	for (const probe of probes) {
		test(`${probe.name}: thrown message contains neither the secret nor derivable cookie material`, () => {
			probe.setup()
			let thrown: unknown
			try {
				mintOwnerCookie({ home, authority: AUTHORITY })
			} catch (error) {
				thrown = error
			}
			expect(thrown).toBeInstanceOf(Error)
			const message = (thrown as Error).message
			expect(message).not.toContain(SECRET_A)
			expect(message).not.toContain("dsh-auth-")
		})
	}
})
