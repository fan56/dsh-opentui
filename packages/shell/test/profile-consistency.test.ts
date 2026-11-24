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
const PROFILE_LITERAL_GUARD_SCRIPTS = [
	"../../../scripts/real-client-gate.sh",
	"../../../scripts/verify-bridge-handshake.mjs",
	"../../../scripts/verify-capcontract-roundtrip.mjs",
	"../../../scripts/verify-s1-model.mjs",
	"../../../scripts/verify-s2-credentials.mjs",
	"../../../scripts/verify-s3-push.mjs",
	"../../../scripts/verify-sk-keymap-ans.mjs",
	"../../../e2e/families/lib/bridge-families.mjs",
	"../../../verify/agents-mount-repro.mjs",
	"../../../scripts/test-tier.mjs",
].map((path) => fileURLToPath(new URL(path, import.meta.url)))

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

	test("guarded scripts do not hard-code the active host profile", () => {
		const forbiddenProfiles = new Set([MJS_DEFAULT_PROFILE, "opentui-inproc"])
		const violations = PROFILE_LITERAL_GUARD_SCRIPTS.flatMap((file) => {
			const code = readFileSync(file, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
				.split(/\r?\n/)
				.map((line) => line.replace(/\/\/.*$/, ""))
				.join("\n")
			return [...forbiddenProfiles]
				.filter((profile) => code.includes(profile))
				.map((profile) => `${file}: hard-coded ${profile}`)
		})
		expect(violations).toEqual([])
	})

	test("real-client gate derives PROFILE from the shared profile-name module", () => {
		const gate = fileURLToPath(new URL("../../../scripts/real-client-gate.sh", import.meta.url))
		const source = readFileSync(gate, "utf8")
		expect(source).not.toContain(MJS_DEFAULT_PROFILE)
		expect(source).not.toContain("opentui-inproc")
		const profileAssignment = source.split(/\r?\n/).find((line) => line.startsWith("PROFILE="))
		expect(profileAssignment).toBeDefined()
		expect(profileAssignment).toContain("node --input-type=module -e")
		expect(profileAssignment).toContain("await import(pathToFileURL(process.argv[1]))")
		expect(profileAssignment).toContain("DEFAULT_PROFILE")
		expect(profileAssignment).toContain("packages/shell/scripts/lib/profile-name.mjs")
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
