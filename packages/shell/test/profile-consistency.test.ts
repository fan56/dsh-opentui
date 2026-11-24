/**
 * P0-3 guard: one profile name, two consumers.
 *
 * The client's config/login faces write to `<dshHome>/profiles/<DEFAULT_PROFILE>`,
 * while the in-process dsh host loads `--profile <PROFILE>` from the provisioner.
 * T11 changes only `scripts/lib/profile-name.mjs`. These tests pin the wiring:
 *   1. the TS re-export and the shared .mjs constant stay equal;
 *   2. the provisioner imports PROFILE from that same module;
 *   3. the seam refuses a local profile-dir write when host and client drift.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
	BridgeSessionSeam,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import { DEFAULT_PROFILE } from "../src/client/profile-constants.ts"
import { DEFAULT_PROFILE as MJS_DEFAULT_PROFILE } from "../scripts/lib/profile-name.mjs"

const PROFILE_CONSTANTS = fileURLToPath(new URL("../src/client/profile-constants.ts", import.meta.url))
const PROVISIONER = fileURLToPath(new URL("../scripts/provision-inproc-profile.mjs", import.meta.url))

describe("profile name single source (P0-3 / T11 pin)", () => {
	test("client DEFAULT_PROFILE === shared .mjs DEFAULT_PROFILE", () => {
		expect(DEFAULT_PROFILE).toBe(MJS_DEFAULT_PROFILE)
	})

	test("provisioner imports PROFILE from the shared module", () => {
		const source = readFileSync(PROVISIONER, "utf8")
		expect(source).toMatch(/import\s*\{\s*DEFAULT_PROFILE\s+as\s+PROFILE\s*\}\s*from\s*['"]\.\/lib\/profile-name\.mjs['"]/)
		expect(source).not.toMatch(/\bconst\s+PROFILE\s*=\s*['"][^'"]+['"]/)
	})

	test("client constants re-export the shared module without redeclaring it", () => {
		const source = readFileSync(PROFILE_CONSTANTS, "utf8")
		expect(source).toMatch(/export\s*\{\s*DEFAULT_PROFILE\s*\}\s*from\s*['"]\.\.\/\.\.\/scripts\/lib\/profile-name\.mjs['"]/)
		expect(source).not.toMatch(/\b(?:const|let|var)\s+DEFAULT_PROFILE\s*=/)
	})
})

function mockTransport(profile?: string): BridgeTransport {
	return {
		request: () => Promise.reject(new Error("unused")),
		onEvent: () => () => {},
		...(profile === undefined ? {} : { profile }),
	}
}

function makeSeam(transport: BridgeTransport, home: string, profile: string): BridgeSessionSeam {
	return new BridgeSessionSeam({
		transport,
		ctx: { logger: { info() {}, warn() {}, error() {} } },
		dshHome: home,
		profile,
	})
}

describe("seam-side write guard (P0-3 double insurance)", () => {
	test("matches when transport profile equals the client profile", () => {
		const home = mkdtempSync(join(tmpdir(), "profile-consistency-"))
		try {
			const seam = makeSeam(mockTransport("same-profile"), home, "same-profile")
			expect(seam.settings?.profileConsistency?.()).toEqual({ ok: true })
		} finally {
			rmSync(home, { recursive: true, force: true })
		}
	})

	test("no host profile exposed skips the guard instead of guessing one", () => {
		const home = mkdtempSync(join(tmpdir(), "profile-consistency-"))
		try {
			const seam = makeSeam(mockTransport(), home, "client-profile")
			// No published fact -> the guard is skipped, never fabricated from
			// the client's own value. Tests/mocks keep their old behavior.
			expect(seam.settings?.profileConsistency?.()).toEqual({ ok: true })
		} finally {
			rmSync(home, { recursive: true, force: true })
		}
	})

	test("mismatch is exposed with BOTH directory paths", () => {
		const home = mkdtempSync(join(tmpdir(), "profile-consistency-"))
		try {
			const seam = makeSeam(mockTransport("host-profile"), home, "client-profile")
			expect(seam.settings?.profileConsistency?.()).toEqual({
				ok: false,
				clientDir: join(home, "profiles", "client-profile"),
				hostDir: join(home, "profiles", "host-profile"),
			})
		} finally {
			rmSync(home, { recursive: true, force: true })
		}
	})

	test("every local profile write path refuses on mismatch with an actionable message", () => {
		const home = mkdtempSync(join(tmpdir(), "profile-consistency-"))
		try {
			const seam = makeSeam(mockTransport("host-profile"), home, "client-profile")
			const clientDir = join(home, "profiles", "client-profile")
			const hostDir = join(home, "profiles", "host-profile")
			const actionable = (message: string): boolean =>
				message.includes(clientDir) && message.includes(hostDir) && message.includes("Fix:")

			expect(() => seam.login.login("REF", "secret")).toThrow()
			expect(() => seam.login.logout("REF")).toThrow()
			expect(() => seam.configSave({})).toThrow()
			let message = ""
			try {
				seam.login.login("REF", "secret")
			} catch (error) {
				message = error instanceof Error ? error.message : String(error)
			}
			expect(actionable(message)).toBe(true)
			// registerRoute is async on the face; the throw becomes a rejection.
			expect(seam.login.registerRoute("provider", undefined)).rejects.toThrow()
		} finally {
			rmSync(home, { recursive: true, force: true })
		}
	})
})
