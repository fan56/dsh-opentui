/**
 * P0-3 guard: one profile name, two consumers.
 *
 * The client's config/login faces write to `<dshHome>/profiles/<DEFAULT_PROFILE>`,
 * while the in-process dsh host loads `--profile <PROFILE>` from the provisioner.
 * If those two names ever drift, /login silently writes credentials somewhere
 * the running host never reads. These tests pin BOTH halves of the fix:
 *   1. the provisioner's literal and the shared constant stay equal (T11 pin);
 *   2. the seam refuses a local profile-dir write when they are not equal.
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

const PROVISIONER = fileURLToPath(new URL("../scripts/provision-inproc-profile.mjs", import.meta.url))

describe("profile name single source (P0-3 / T11 pin)", () => {
	test("provisioner PROFILE === client DEFAULT_PROFILE", () => {
		const source = readFileSync(PROVISIONER, "utf8")
		const match = /const PROFILE = ['"]([^'"]+)['"]/.exec(source)
		expect(match).not.toBeNull()
		const hostProfile = match![1]
		expect(hostProfile).toBe(DEFAULT_PROFILE)
	})

	test("mismatch gives a rename guide that names both edit sites", () => {
		// The failure message is the guard's whole value when T11 forgets a site.
		const source = readFileSync(PROVISIONER, "utf8")
		const hostProfile = /const PROFILE = ['"]([^'"]+)['"]/.exec(source)?.[1]
		const guide = [
			`Profile name drift: client DEFAULT_PROFILE=${DEFAULT_PROFILE} but provisioner PROFILE=${hostProfile}.`,
			"T11 fix: set BOTH to the new name — packages/shell/src/client/profile-constants.ts",
			"and packages/shell/scripts/provision-inproc-profile.mjs — then re-run this test.",
		].join(" ")
		if (hostProfile !== DEFAULT_PROFILE) {
			throw new Error(guide)
		}
		expect(guide).toContain("profile-constants.ts")
		expect(guide).toContain("provision-inproc-profile.mjs")
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
