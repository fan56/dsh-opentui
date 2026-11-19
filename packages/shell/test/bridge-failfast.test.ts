/**
 * P0 fail-fast three-element tests.
 *
 * Both inproc failure paths must print the SAME three self-contained lines
 * (T11 original: 诊断 + 修复命令 + 模式说明):
 *   1. diagnosis with expected/actual where the path has them
 *   2. dsh-opentui --repair-bridge
 *   3. the mode notice: append comes via the bridge section, presets standard
 *
 * The regression was that these lived in two hard-coded sources that never
 * met: BridgeBootstrapError (handshake) had all three; ProvisionError
 * (fingerprint) had only the first two. This file pins the single source AND
 * both consumers.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
	BRIDGE_APPEND_PRESET_NOTICE,
	BRIDGE_REPAIR_COMMAND,
	BRIDGE_REPAIR_HINT,
	formatBridgeFailFastMessage,
} from "../scripts/lib/bridge-failfast-text.mjs"
import {
	BridgeBootstrapError,
	formatBridgeBootstrapMessage,
} from "../src/client/seam-bootstrap.ts"

const SCRIPT = fileURLToPath(new URL("../scripts/provision-inproc-profile.mjs", import.meta.url))

/** The three element lines, in order, as they must appear in either path. */
function assertThreeElements(text: string, diagnosisNeedle: string): void {
	const lines = text.split("\n")
	// 1. diagnosis (with expected/actual where the path carries them)
	expect(text).toContain(diagnosisNeedle)
	// 2. repair command — present in BOTH phrasings via the ONE shared constant
	expect(text).toContain(BRIDGE_REPAIR_COMMAND)
	// 3. mode notice — the element the fingerprint path used to omit
	expect(text).toContain(BRIDGE_APPEND_PRESET_NOTICE)
	expect(BRIDGE_APPEND_PRESET_NOTICE.length).toBeGreaterThan(0)
	// the three lines are self-contained and present in one message
	expect(lines.some((l) => l.includes(diagnosisNeedle))).toBe(true)
	expect(lines.some((l) => l.includes(BRIDGE_REPAIR_COMMAND))).toBe(true)
	expect(lines.some((l) => l.includes(BRIDGE_APPEND_PRESET_NOTICE))).toBe(true)
}

// ---------------------------------------------------------------------------
// 1. The single source composes the three elements (incl. expected/actual).
// ---------------------------------------------------------------------------
describe("shared fail-fast text — single source", () => {
	test("constants are the canonical three-element strings", () => {
		expect(BRIDGE_REPAIR_COMMAND).toBe("dsh-opentui --repair-bridge")
		expect(BRIDGE_REPAIR_HINT).toContain(BRIDGE_REPAIR_COMMAND)
		// M3-08: the notice now states append is injected via the bridge section
		// and presets are standard only — the stale "unavailable" claim is gone.
		expect(BRIDGE_APPEND_PRESET_NOTICE).toContain("bridge section")
		expect(BRIDGE_APPEND_PRESET_NOTICE).toContain("presets are standard only")
	})

	test("formatBridgeFailFastMessage emits exactly diagnosis + Fix + notice", () => {
		const diagnosis =
			'bridge identity check failed — sha256(index.js) mismatch: expected "abc", actual "def"'
		const msg = formatBridgeFailFastMessage(diagnosis)
		const lines = msg.split("\n")
		expect(lines).toHaveLength(3)
		expect(lines[0]).toBe(diagnosis)
		expect(lines[0]).toContain('expected "abc"')
		expect(lines[0]).toContain('actual "def"')
		expect(lines[1]).toBe(`Fix: ${BRIDGE_REPAIR_COMMAND}`)
		expect(lines[2]).toBe(BRIDGE_APPEND_PRESET_NOTICE)
	})
})

// ---------------------------------------------------------------------------
// 2. Handshake path (BridgeBootstrapError) — uses the shared source.
// ---------------------------------------------------------------------------
describe("handshake path fail-fast (BridgeBootstrapError)", () => {
	test("message carries all three lines, expected/actual in diagnosis", () => {
		const err = new BridgeBootstrapError({
			code: "VERSION_INCOMPATIBLE",
			diagnosis: "protocolVersion mismatch: client=1, bridge=2, host=0.2.2",
		})
		expect(err.message.split("\n")).toHaveLength(3)
		assertThreeElements(err.message, "protocolVersion mismatch: client=1, bridge=2")
		expect(err.message).toContain(`Fix: ${BRIDGE_REPAIR_COMMAND}`)
	})

	test("formatBridgeBootstrapMessage delegates to the shared composer", () => {
		const viaShared = formatBridgeFailFastMessage("dsh-opentui inproc bridge seam failed [X]: boom")
		const viaBootstrap = formatBridgeBootstrapMessage({ code: "X", diagnosis: "boom" })
		// same three lines byte-for-byte (repair command + notice not re-hardcoded)
		expect(viaBootstrap).toBe(viaShared)
	})
})

// ---------------------------------------------------------------------------
// 3. Fingerprint path (ProvisionError from the spawned script).
// ---------------------------------------------------------------------------
function runProvision(home: string): { status: number | null; stderr: string; stdout: string } {
	const result = Bun.spawnSync([process.execPath, SCRIPT], {
		env: { ...process.env, DSH_HOME: home, DSH_OPENTUI_INPROC: "1" },
	})
	return {
		status: result.exitCode,
		stderr: result.stderr.toString("utf8"),
		stdout: result.stdout.toString("utf8"),
	}
}

describe("fingerprint path fail-fast (ProvisionError)", () => {
	test("missing DSH_HOME failure still carries all three elements", () => {
		const root = mkdtempSync(join(tmpdir(), "dsh-failfast-home-"))
		try {
			const missingHome = join(root, "does-not-exist")
			const run = runProvision(missingHome)
			expect(run.status).toBe(1)
			assertThreeElements(run.stderr, "DSH_HOME directory does not exist")
			// the repair element keeps its link-vs-content caveat
			expect(run.stderr).toContain(BRIDGE_REPAIR_HINT)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("fingerprint mismatch failure carries expected/actual + all three elements", () => {
		const fpPath = fileURLToPath(new URL("../dist/bridge/bundle-fingerprint.json", import.meta.url))
		if (!existsSync(fpPath)) return // bridge artifact not built in this checkout
		const expected = JSON.parse(readFileSync(fpPath, "utf8")) as { name: string; version: string; sha256: string }

		const root = mkdtempSync(join(tmpdir(), "dsh-failfast-fp-"))
		try {
			const home = join(root, "home")
			const profileDir = join(home, "profiles", "opentui-inproc")
			const linkDir = join(profileDir, "node_modules", "@aiwayds")
			mkdirSync(home, { recursive: true })
			mkdirSync(profileDir, { recursive: true })
			mkdirSync(linkDir, { recursive: true })
			writeFileSync(
				join(profileDir, "package.json"),
				JSON.stringify({
					name: "dsh-profile-opentui-inproc",
					private: true,
					dsh: {
						profile: {
							bundles: ["@deepseek-ai/dsh-base", "@aiwayds/dsh-opentui-bridge"],
						},
					},
				}),
			)
			// A bogus bridge dir: name matches, version/hash mismatch the REAL fingerprint.
			const bogus = join(root, "bogus-bridge")
			mkdirSync(bogus, { recursive: true })
			writeFileSync(join(bogus, "package.json"), JSON.stringify({ name: expected.name, version: "0.0.0-BOGUS" }))
			writeFileSync(join(bogus, "index.js"), "// bogus\n")
			symlinkSync(bogus, join(linkDir, "dsh-opentui-bridge"), "dir")

			const run = runProvision(home)
			expect(run.status).toBe(1)
			expect(run.stderr).toContain("bridge identity check failed")
			// element 1 carries expected/actual on the fingerprint path
			expect(run.stderr).toContain(`expected "${expected.version}"`)
			expect(run.stderr).toContain('actual "0.0.0-BOGUS"')
			// elements 2 + 3 from the single shared source
			assertThreeElements(run.stderr, "bridge identity check failed")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
