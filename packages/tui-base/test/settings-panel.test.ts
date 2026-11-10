/**
 * /settings panel v1 (whitelist-driven): the row builders (local/host/other),
 * schema enum+bounds extraction, the two write plans (configSave patch shape
 * and settings path-op shape), the conflict retry contract, the read-only
 * profile lockout, the Esc hierarchy and the module-signal lifetime.
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
	LOCAL_SETTING_IDS,
	SETTINGS_ZONE_TITLES,
	buildHostItems,
	buildLocalItems,
	buildOtherItems,
	commitHostWrite,
	currentHostRevision,
	filterSettingsItems,
	parseIntegerInput,
	planHostWrite,
	planLocalWrite,
	presetEnumFromSchema,
	readSchemaField,
	settingsEscape,
	settingsInputLines,
	settingsLines,
	settingsNamespaceCount,
	settingsOptionLines,
	settingsPanelOpen,
	settingsSummary,
	settingsWritable,
	useSettingsPanelOpenState,
} from "../src/routes/session/settings-panel"
import { DEFAULT_FOOTER_HINTS } from "../src/routes/session/hints-line"
import type { SeamSettingsDocument, SeamSettingsRow } from "../src/seams/session"

function doc(namespaces: SeamSettingsRow[], writable = true): SeamSettingsDocument {
	return { writable, hasDocument: true, namespaces }
}

function localItems(writable = true) {
	return buildLocalItems({
		merged: {},
		profile: {},
		workspace: {},
		themeNames: ["dsh-blue", "tokyonight"],
		writable,
	})
}

const subagentDoc = doc([
	{ ns: "subagent", revision: 3, value: { maxActiveSubagents: 8, maxDepth: 1 } },
	{ ns: "ui-theme", revision: 2, value: { preference: "dark" } },
	{ ns: "llm-pi-ai", revision: 5, value: { providers: {} } },
	{ ns: "dsh-tui", revision: 1, value: {} },
])

describe("v1 whitelist", () => {
	test("local zone = the 9 v1 items (footerHints expands to its 8 segments)", () => {
		const items = localItems()
		expect(items).toHaveLength(LOCAL_SETTING_IDS.length)
		expect(items).toHaveLength(17)
		expect(items.filter((item) => item.id.startsWith("footerHints."))).toHaveLength(8)
		expect(items.map((item) => item.id)).toEqual([...LOCAL_SETTING_IDS])
		expect(items.map((item) => item.zone)).toEqual(Array(17).fill("local"))
	})

	test("host zone is exactly the four whitelisted rows, in fixed order", () => {
		const items = buildHostItems(subagentDoc, true)
		expect(items.map((item) => item.id)).toEqual([
			"subagent.maxActiveSubagents",
			"subagent.maxDepth",
			"permission.defaultPreset",
			"session-log-deepseek.enabled",
		])
	})

	test("other zone lists every non-whitelisted namespace and hides dsh-tui", () => {
		const items = buildOtherItems(subagentDoc)
		expect(items.map((item) => item.label)).toEqual(["ui-theme", "llm-pi-ai"])
		expect(items.every((item) => item.editable === false)).toBe(true)
		expect(items.every((item) => item.note === "只读 · 本 TUI 不消费")).toBe(true)
	})

	test("namespace count excludes nothing (header reports the document size)", () => {
		expect(settingsNamespaceCount(subagentDoc)).toBe(4)
		expect(settingsNamespaceCount(undefined)).toBe(0)
	})
})

describe("host baseline (n/a, never a guessed default)", () => {
	test("a namespace the document does not carry renders n/a and is not editable", () => {
		const items = buildHostItems(subagentDoc, true)
		const permission = items.find((item) => item.id === "permission.defaultPreset")!
		expect(permission.value).toBe("n/a")
		expect(permission.editable).toBe(false)
		expect(permission.note).toContain("n/a")
		const enabled = items.find((item) => item.id === "session-log-deepseek.enabled")!
		expect(enabled.value).toBe("n/a")
	})

	test("a served key shows its value and is editable when the document is writable", () => {
		const items = buildHostItems(subagentDoc, true)
		const active = items.find((item) => item.id === "subagent.maxActiveSubagents")!
		expect(active.value).toBe("8")
		expect(active.editable).toBe(true)
		expect(active.revision).toBe(3)
		expect(active.note).toBeUndefined()
	})

	test("a read-only document disables the served host rows", () => {
		const items = buildHostItems(subagentDoc, false)
		expect(items.find((item) => item.id === "subagent.maxDepth")!.editable).toBe(false)
	})

	test("the read-only lockout copies the reason and disables both write halves", () => {
		expect(settingsWritable(doc([], false), undefined, true)).toEqual({
			local: false,
			host: false,
			reason: "profile 的 settings 文档只读（writable: false）— 已禁用全部写控件",
		})
		const locked = localItems(false)
		expect(locked.every((item) => item.editable === false)).toBe(true)
	})

	test("no settings face keeps local writes and degrades the host zone", () => {
		const verdict = settingsWritable(undefined, undefined, false)
		expect(verdict.local).toBe(true)
		expect(verdict.host).toBe(false)
		expect(verdict.reason).toContain("不可用")
	})

	test("a failed describe keeps LOCAL writes enabled (configSave is independent)", () => {
		const verdict = settingsWritable(undefined, "connection refused", true)
		expect(verdict.local).toBe(true)
		expect(verdict.host).toBe(false)
		expect(verdict.reason).toContain("本地偏好仍可写")
	})
})

describe("schema extraction", () => {
	const permissionSchema = {
		uid: 1,
		refs: {
			1: { type: "object", dict: { presets: 2, defaultPreset: 3 } },
			2: {
				type: "dict",
				dict: { "read-only": 4, "workspace-write": 4, "danger-full-access": 4 },
			},
			3: { type: "string" },
			4: { type: "object", dict: {} },
		},
	}

	test("defaultPreset's enum is the sibling presets dict keys (schema-sourced)", () => {
		expect(presetEnumFromSchema(permissionSchema)).toEqual([
			"read-only",
			"workspace-write",
			"danger-full-access",
		])
		expect(readSchemaField(permissionSchema, ["defaultPreset"])).toEqual({})
	})

	// Live `settings/describe` fact (opentui profile): the permission namespace
	// schema carries ONLY defaultPreset (plain string) — there is no sibling
	// `presets` dict, so a schema-derived enum cannot exist on the real host.
	// `custom`/`auto` are reserved names the permission service refuses as
	// configured preset keys, so no filter is needed either way.
	const livePermissionSchema = {
		uid: 5767,
		refs: {
			5766: { type: "string", meta: {} },
			5767: { type: "object", meta: { default: {} }, dict: { defaultPreset: 5766 } },
		},
	}

	test("the real host schema with no catalog: read-only effective value, never an empty picker", () => {
		expect(presetEnumFromSchema(livePermissionSchema)).toEqual([])
		const items = buildHostItems(
			doc([{ ns: "permission", revision: 0, value: {}, base: {}, schema: livePermissionSchema }]),
			true,
		)
		const preset = items.find((item) => item.id === "permission.defaultPreset")!
		expect(preset.options).toBeUndefined()
		expect(preset.note).toBe("无 preset catalog（permissionPresets/catalog 不可用）— 只读展示生效值")
		expect(preset.editable).toBe(false)
	})

	const catalogDoc = doc([
		{ ns: "permission", revision: 4, value: { defaultPreset: "workspace-write" }, schema: livePermissionSchema },
	])

	test("the host catalog supplies the real default options and marks the current value", () => {
		const items = buildHostItems(catalogDoc, true, {
			options: [],
			defaultOptions: [
				{ value: "read-only", name: "Read only" },
				{ value: "workspace-write", name: "Workspace write" },
				{ value: "danger-full-access", name: "Full access" },
			],
			defaultPreset: "read-only",
		})
		const preset = items.find((item) => item.id === "permission.defaultPreset")!
		expect(preset.options).toEqual(["read-only", "workspace-write", "danger-full-access"])
		expect(preset.value).toBe("workspace-write") // the settings value wins as current
		expect(preset.options).toContain(preset.value)
		expect(preset.editable).toBe(true)
		expect(preset.source).toContain("permissionPresets/catalog")
		expect(preset.note).toBeUndefined()
	})

	test("catalog defaultPreset is the displayed effective value when the field is unset", () => {
		const items = buildHostItems(
			doc([{ ns: "permission", revision: 4, value: {}, schema: livePermissionSchema }]),
			true,
			{
				options: [],
				defaultOptions: [{ value: "read-only" }, { value: "workspace-write" }],
				defaultPreset: "read-only",
			},
		)
		const preset = items.find((item) => item.id === "permission.defaultPreset")!
		expect(preset.value).toBe("read-only")
		expect(preset.options).toEqual(["read-only", "workspace-write"])
		expect(preset.editable).toBe(true)
	})

	test("a catalog with no default options degrades the row to read-only", () => {
		const items = buildHostItems(catalogDoc, true, {
			options: [{ value: "custom" }],
			defaultOptions: [],
			defaultPreset: "read-only",
		})
		const preset = items.find((item) => item.id === "permission.defaultPreset")!
		expect(preset.options).toBeUndefined()
		expect(preset.editable).toBe(false)
		expect(preset.note).toBe("catalog 未声明可选项 — 只读展示生效值")
		expect(preset.value).toBe("workspace-write") // still shows the effective value
	})

	test("a current value outside the catalog options is noted, not silently dropped", () => {
		const items = buildHostItems(catalogDoc, true, {
			options: [],
			defaultOptions: [{ value: "read-only" }],
			defaultPreset: "read-only",
		})
		const preset = items.find((item) => item.id === "permission.defaultPreset")!
		expect(preset.value).toBe("workspace-write")
		expect(preset.note).toContain("不在 catalog 默认选项中")
	})

	test("a schema-served presets dict is a valid-value list, returned unfiltered", () => {
		const schema = {
			uid: 1,
			refs: {
				1: { type: "object", dict: { presets: 2, defaultPreset: 3 } },
				2: { type: "dict", dict: { "plan-mode": 4, "workspace-write": 4 } },
				3: { type: "string" },
				4: { type: "object", dict: {} },
			},
		}
		expect(presetEnumFromSchema(schema)).toEqual(["plan-mode", "workspace-write"])
	})

	test("a union-of-consts enum and number bounds read through the envelope", () => {
		const schema = {
			uid: 1,
			refs: {
				1: { type: "object", dict: { maxDepth: 2, mode: 3 } },
				2: { type: "number", meta: { min: 0, max: 9, step: 1 } },
				3: { type: "union", list: [{ type: "const", value: "a" }, { type: "const", value: "b" }] },
			},
		}
		expect(readSchemaField(schema, ["maxDepth"])).toEqual({ min: 0, max: 9 })
		expect(readSchemaField(schema, ["mode"]).options).toEqual(["a", "b"])
	})

	test("an unknown path yields no schema facts (callers keep n/a)", () => {
		expect(readSchemaField(permissionSchema, ["nope"])).toEqual({})
		expect(readSchemaField(undefined, ["x"])).toEqual({})
	})

	test("a schema-declared but unset key renders (unset) and stays editable", () => {
		const items = buildHostItems(
			doc([{ ns: "permission", revision: 2, value: {}, schema: permissionSchema }]),
			true,
		)
		const preset = items.find((item) => item.id === "permission.defaultPreset")!
		expect(preset.value).toBe("(unset)")
		expect(preset.editable).toBe(true)
		expect(preset.options).toEqual(["read-only", "workspace-write", "danger-full-access"])
	})

	test("a key declared nowhere (no value, no base, no schema) stays n/a", () => {
		const items = buildHostItems(doc([{ ns: "permission", revision: 2, value: {} }]), true)
		const preset = items.find((item) => item.id === "permission.defaultPreset")!
		expect(preset.value).toBe("n/a")
		expect(preset.editable).toBe(false)
	})

	test("the composition base counts as a baseline (value absent, base served)", () => {
		const items = buildHostItems(
			doc([{ ns: "subagent", revision: 1, value: {}, base: { maxDepth: 1 } }]),
			true,
		)
		const depth = items.find((item) => item.id === "subagent.maxDepth")!
		expect(depth.value).toBe("1")
		expect(depth.editable).toBe(true)
	})

	test("buildHostItems uses the derived preset enum", () => {
		const items = buildHostItems(
			doc([{ ns: "permission", revision: 1, value: { defaultPreset: "read-only" }, schema: permissionSchema }]),
			true,
		)
		const preset = items.find((item) => item.id === "permission.defaultPreset")!
		expect(preset.value).toBe("read-only")
		expect(preset.options).toEqual(["read-only", "workspace-write", "danger-full-access"])
		expect(preset.editable).toBe(true)
	})
})

describe("local write plan (configSave patch shapes)", () => {
	const item = (id: string) => localItems().find((candidate) => candidate.id === id)!

	test("enum writes the bare key", () => {
		expect(planLocalWrite(item("motion"), "reduced", DEFAULT_FOOTER_HINTS)).toEqual({
			ok: true,
			patch: { motion: "reduced" },
			applied: "reduced",
		})
		expect(planLocalWrite(item("cacheHitMode"), "session", DEFAULT_FOOTER_HINTS)).toMatchObject({
			patch: { cacheHitMode: "session" },
		})
	})

	test("a footer hint segment rewrites the full map (other segments preserved)", () => {
		const plan = planLocalWrite(item("footerHints.send"), false, { ...DEFAULT_FOOTER_HINTS })
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		const hints = plan.patch.footerHints as Record<string, boolean>
		expect(hints.send).toBe(false)
		expect(hints.quit).toBe(true)
		expect(hints.subagents).toBe(true)
		expect(plan.applied).toBe(false)
	})

	test("a number writes a number; empty unsets; bad input errors", () => {
		expect(planLocalWrite(item("retentionDays"), "30", DEFAULT_FOOTER_HINTS)).toEqual({
			ok: true,
			patch: { retentionDays: 30 },
			applied: 30,
		})
		expect(planLocalWrite(item("retentionDays"), "", DEFAULT_FOOTER_HINTS)).toEqual({
			ok: true,
			patch: { retentionDays: undefined },
			applied: undefined,
		})
		expect(planLocalWrite(item("maxRounds"), "-1", DEFAULT_FOOTER_HINTS)).toEqual({
			ok: false,
			error: "must be >= 0",
		})
	})

	test("an empty enum/text value is refused", () => {
		expect(planLocalWrite(item("hintsLocale"), "", DEFAULT_FOOTER_HINTS)).toEqual({
			ok: false,
			error: "value must not be empty",
		})
	})
})

describe("host write plan (path ops only)", () => {
	test("number and toggle rows produce set path ops (never replace)", () => {
		const items = buildHostItems(subagentDoc, true)
		const plan = planHostWrite(items.find((item) => item.id === "subagent.maxActiveSubagents")!, "12")
		expect(plan).toEqual({
			ok: true,
			ns: "subagent",
			ops: [{ op: "set", path: ["maxActiveSubagents"], value: 12 }],
			applied: 12,
		})
		const enabledDoc = doc([
			{ ns: "session-log-deepseek", revision: 1, value: { enabled: true } },
		])
		const toggle = planHostWrite(
			buildHostItems(enabledDoc, true).find((item) => item.id === "session-log-deepseek.enabled")!,
			"off",
		)
		expect(toggle).toEqual({
			ok: true,
			ns: "session-log-deepseek",
			ops: [{ op: "set", path: ["enabled"], value: false }],
			applied: false,
		})
	})

	test("a preset string writes the exact path", () => {
		const items = buildHostItems(
			doc([{ ns: "permission", revision: 7, value: { defaultPreset: "read-only" } }]),
			true,
		)
		expect(planHostWrite(items.find((item) => item.id === "permission.defaultPreset")!, "workspace-write")).toEqual({
			ok: true,
			ns: "permission",
			ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }],
			applied: "workspace-write",
		})
	})

	test("bounds come from the schema and are enforced", () => {
		const items = buildHostItems(
			doc([
				{
					ns: "subagent",
					revision: 1,
					value: { maxActiveSubagents: 8 },
					schema: { uid: 1, refs: { 1: { type: "object", dict: { maxActiveSubagents: 2 } }, 2: { type: "number", meta: { min: 1, max: 8 } } } },
				},
			]),
			true,
		)
		const item = items.find((candidate) => candidate.id === "subagent.maxActiveSubagents")!
		expect(item.max).toBe(8)
		expect(planHostWrite(item, "9")).toEqual({ ok: false, error: "must be <= 8" })
	})
})

describe("conflict retry", () => {
	const ops = [{ op: "set", path: ["maxActiveSubagents"], value: 12 }] as const

	function docAt(revision: number): SeamSettingsDocument {
		return doc([{ ns: "subagent", revision, value: { maxActiveSubagents: revision } }])
	}

	test("a stale revision re-reads and retries once with the fresh revision", async () => {
		const revisions: (number | undefined)[] = []
		let describes = 0
		const outcome = await commitHostWrite({
			mutate: async (_ns, _ops, revision) => {
				revisions.push(revision)
				return revision === 4
					? { ok: true as const }
					: { ok: false as const, conflict: true, error: "stale" }
			},
			describe: async () => {
				describes++
				return docAt(4)
			},
			ns: "subagent",
			ops: [...ops],
			revision: 3,
		})
		expect(revisions).toEqual([3, 4])
		expect(outcome.attempts).toBe(2)
		expect(outcome.result.ok).toBe(true)
		expect(describes).toBe(2) // after each write
		expect(outcome.document?.namespaces[0]!.revision).toBe(4)
	})

	test("a second conflict is surfaced, not swallowed", async () => {
		const revisions: (number | undefined)[] = []
		const outcome = await commitHostWrite({
			mutate: async (_ns, _ops, revision) => {
				revisions.push(revision)
				return { ok: false as const, conflict: true, error: "stale" }
			},
			describe: async () => docAt(9),
			ns: "subagent",
			ops: [...ops],
			revision: 3,
		})
		expect(revisions).toEqual([3, 9])
		expect(outcome.attempts).toBe(2)
		expect(outcome.result).toMatchObject({ ok: false, conflict: true })
	})

	test("a non-conflict failure is not retried", async () => {
		let mutates = 0
		const outcome = await commitHostWrite({
			mutate: async () => {
				mutates++
				return { ok: false as const, conflict: false, error: "rejected" }
			},
			describe: async () => docAt(1),
			ns: "subagent",
			ops: [...ops],
			revision: 1,
		})
		expect(mutates).toBe(1)
		expect(outcome.attempts).toBe(1)
		expect(outcome.result).toMatchObject({ ok: false, conflict: false, error: "rejected" })
	})

	test("revision lookup is per namespace", () => {
		expect(currentHostRevision(subagentDoc, "subagent")).toBe(3)
		expect(currentHostRevision(subagentDoc, "permission")).toBeUndefined()
	})

	test("a conflict with a FAILED re-read describe is not retried blind (C3)", async () => {
		let mutates = 0
		const outcome = await commitHostWrite({
			mutate: async () => {
				mutates++
				return { ok: false as const, conflict: true, error: "stale" }
			},
			describe: async () => {
				throw new Error("describe down")
			},
			ns: "subagent",
			ops: [...ops],
			revision: 3,
		})
		expect(mutates).toBe(1) // no fresh revision → no second write
		expect(outcome.attempts).toBe(1)
		expect(outcome.result).toMatchObject({ ok: false, conflict: true })
		expect(outcome.document).toBeUndefined()
		expect(outcome.describeError).toBe("describe down")
	})

	test("a successful write with a failed refresh retries describe ONCE and flags it (M2b)", async () => {
		let describes = 0
		const outcome = await commitHostWrite({
			mutate: async () => ({ ok: true as const }),
			describe: async () => {
				describes++
				throw new Error("refresh down")
			},
			ns: "subagent",
			ops: [...ops],
			revision: 3,
		})
		expect(describes).toBe(2) // initial + exactly one refresh retry
		expect(outcome.result.ok).toBe(true)
		expect(outcome.refreshFailed).toBe(true)
		expect(outcome.document).toBeUndefined()
		expect(outcome.describeError).toBe("refresh down")
	})

	test("a refresh that succeeds on the retry is NOT flagged", async () => {
		let describes = 0
		const outcome = await commitHostWrite({
			mutate: async () => ({ ok: true as const }),
			describe: async () => {
				describes++
				if (describes === 1) throw new Error("transient")
				return docAt(4)
			},
			ns: "subagent",
			ops: [...ops],
			revision: 3,
		})
		expect(describes).toBe(2)
		expect(outcome.refreshFailed).toBeUndefined()
		expect(outcome.describeError).toBeUndefined()
		expect(outcome.document?.namespaces[0]!.revision).toBe(4)
	})
})

describe("Esc hierarchy", () => {
	test("filter clears before the level pops; an empty list filter closes", () => {
		expect(settingsEscape("list", "motion")).toEqual({ action: "clearFilter" })
		expect(settingsEscape("list", "")).toEqual({ action: "close" })
		expect(settingsEscape("options", "x")).toEqual({ action: "back" })
		expect(settingsEscape("input", "")).toEqual({ action: "back" })
	})
})

describe("rendering + filtering", () => {
	const items = [...localItems(), ...buildHostItems(subagentDoc, true), ...buildOtherItems(subagentDoc)]

	test("the three zone titles always render, even under an empty filter result", () => {
		const lines = settingsLines({
			items: [],
			cursor: 0,
			width: 120,
			filter: "zzz",
			writable: true,
			namespaceCount: 0,
			hasDocument: false,
		})
		const text = lines.map((line) => line.text).join("\n")
		for (const title of Object.values(SETTINGS_ZONE_TITLES)) expect(text).toContain(title)
		expect(text).toContain("no setting matches")
	})

	test("the cursor row carries the ▸ marker; editable values carry ✎", () => {
		const lines = settingsLines({
			items,
			cursor: 0,
			width: 140,
			filter: "",
			writable: true,
			namespaceCount: 4,
			hasDocument: true,
		})
		const selected = lines.filter((line) => line.tone === "selected")
		expect(selected).toHaveLength(1)
		expect(selected[0]!.text.startsWith("▸ ")).toBe(true)
		expect(selected[0]!.text).toContain("✎")
	})

	test("filtering matches label, value and source; the whitelist order survives", () => {
		expect(filterSettingsItems(items, "footerHints.quit").map((item) => item.id)).toEqual(["footerHints.quit"])
		expect(filterSettingsItems(items, "cordis.patch.yml").every((item) => item.zone === "host")).toBe(true)
		expect(filterSettingsItems(items, "本 TUI 不消费").every((item) => item.zone === "other")).toBe(true)
		expect(filterSettingsItems(items, "").length).toBe(items.length)
	})

	test("the options layer renders a failed write's status (the list footer is off screen)", () => {
		const item = items.find((candidate) => candidate.id === "motion")!
		const lines = settingsOptionLines(item, item.options ?? [], 0, 120, "✘ 写入失败：disk full")
		const text = lines.map((line) => line.text).join("\n")
		expect(text).toContain("✘ 写入失败：disk full")
		const clean = settingsOptionLines(item, item.options ?? [], 0, 120)
		expect(clean.map((line) => line.text).join("\n")).not.toContain("✘")
	})

	test("the input layer's empty-value hint follows the write path (local number unsets, host number/text refuses)", () => {
		const localNumber = items.find((candidate) => candidate.id === "retentionDays")!
		const hostNumber = items.find((candidate) => candidate.id === "subagent.maxActiveSubagents")!
		const hostText = items.find((candidate) => candidate.id === "permission.defaultPreset")!
		const footer = (item: typeof localNumber) =>
			settingsInputLines(item, "", 140).map((line) => line.text).join("\n")
		expect(footer(localNumber)).toContain("empty = unset")
		expect(footer(hostNumber)).toContain("empty is refused")
		expect(footer(hostText)).toContain("empty is refused")
	})

	test("the header reports read-only + the reason", () => {
		const lines = settingsLines({
			items,
			cursor: 0,
			width: 140,
			filter: "",
			writable: false,
			writableReason: "profile 的 settings 文档只读（writable: false）— 已禁用全部写控件",
			namespaceCount: 4,
			hasDocument: true,
		})
		const text = lines.map((line) => line.text).join("\n")
		expect(text).toContain("document read-only")
		expect(text).toContain("已禁用全部写控件")
	})

	test("exit summary", () => {
		expect(settingsSummary([])).toBe("Settings unchanged.")
		expect(settingsSummary(["motion"])).toBe("Settings updated: motion")
	})
})

describe("integer parser", () => {
	test("accepts integers, enforces bounds", () => {
		expect(parseIntegerInput("12")).toEqual({ ok: true, value: 12 })
		expect(parseIntegerInput(" 0 ")).toEqual({ ok: true, value: 0 })
		expect(parseIntegerInput("1.5")).toMatchObject({ ok: false })
		expect(parseIntegerInput("x")).toMatchObject({ ok: false })
		expect(parseIntegerInput("-1", 0)).toEqual({ ok: false, error: "must be >= 0" })
	})
})

describe("open-state lifetime", () => {
	test("unmount resets the /settings open signal so the sidebar Esc layer recovers", () => {
		const dispose = createRoot((dispose) => {
			const [open, setOpen] = useSettingsPanelOpenState()
			setOpen(true)
			expect(open()).toBe(true)
			return dispose
		})
		dispose()
		expect(settingsPanelOpen()).toBe(false)
	})
})
