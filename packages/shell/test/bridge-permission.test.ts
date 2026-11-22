/**
 * 026 web-mirror — pure `commands/execute` projection tests (AMEND-2 C-1
 * blind-spot family: result jsonSchema:null). This hand-written SECOND whitelist
 * is the load-bearing defence: only ok/matched/text cross, free text is capped
 * and control-stripped, every hostile key is dropped. No live host / no real
 * secrets (SENTINEL is a fixed fake string).
 */
import { describe, expect, test } from "bun:test"
import {
	projectPermissionSwitch,
	unwrapWireValue,
} from "../src/client/bridge-permission.ts"

const SENTINEL = "O26_SENTINEL_synthetic_no_real_secret"

describe("026 commands/execute projection — SECOND whitelist", () => {
	test("unwrapWireValue accepts {value} wrap and direct object", () => {
		expect(unwrapWireValue({ value: 42 })).toBe(42)
		const obj = { result: { kind: "success" } }
		expect(unwrapWireValue(obj)).toBe(obj)
	})

	const okReply = {
		commandId: "c-1",
		result: { kind: "success", text: "preset workspace-write" },
	}

	test("answer-bearing: success reply -> matched/ok + exact host text", () => {
		const out = projectPermissionSwitch(okReply)
		expect(out).toEqual({ ok: true, matched: true, text: "preset workspace-write" })
	})

	test("{value} wrap accepted (generic wire null/primitive wrap)", () => {
		expect(projectPermissionSwitch({ value: okReply })).toEqual({
			ok: true, matched: true, text: "preset workspace-write",
		})
	})

	test("error kind -> ok=false, matched=true, text kept", () => {
		const out = projectPermissionSwitch({ result: { kind: "error", text: "unknown preset x" } })
		expect(out.ok).toBe(false)
		expect(out.matched).toBe(true)
		expect(out.text).toBe("unknown preset x")
	})

	test("unmatched: undefined / {value:undefined} / {} -> matched=false, no fabricated success", () => {
		expect(projectPermissionSwitch(undefined)).toEqual({ ok: false, matched: false, text: "" })
		expect(projectPermissionSwitch({ value: undefined })).toEqual({ ok: false, matched: false, text: "" })
		expect(projectPermissionSwitch(null)).toEqual({ ok: false, matched: false, text: "" })
		expect(projectPermissionSwitch({})).toEqual({ ok: false, matched: false, text: "" })
	})

	test("SENTINEL: hostile keys at every depth dropped; only fixed fields survive", () => {
		const hostile = {
			commandId: "c-1",
			result: { kind: "success", text: "preset x", apiKey: SENTINEL, token: SENTINEL },
			apiKey: SENTINEL, token: SENTINEL, secret: SENTINEL,
			password: SENTINEL, authorize: SENTINEL, bearer: SENTINEL, credential: SENTINEL,
		}
		const out = projectPermissionSwitch(hostile)
		expect(out).toEqual({ ok: true, matched: true, text: "preset x" })
		const json = JSON.stringify(out)
		for (const key of ["apiKey", "token", "secret", "password", "authorize", "bearer", "credential"]) {
			expect(json).not.toContain(key)
		}
		expect(json).not.toContain(SENTINEL)
	})

	test("hostile-only record (no recognised field) -> honest unmatched", () => {
		const out = projectPermissionSwitch({ apiKey: SENTINEL, token: SENTINEL })
		expect(out).toEqual({ ok: false, matched: false, text: "" })
	})

	test("free text capped + control characters stripped", () => {
		const long = "a".repeat(9000) + "\u0000\u001f\u007f\u009fTAIL"
		const out = projectPermissionSwitch({ result: { kind: "success", text: long } })
		expect(out.text.length).toBe(4096)
		expect(out.text).not.toContain("\u0000")
		expect(out.text).not.toContain("TAIL")
	})
})
