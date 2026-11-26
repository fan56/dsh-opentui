/**
 * retention B4/C7 — /prune-restore command, locale-key and ledger tests.
 * The fake seam never touches fs: list rows carry only id/movedAt/size, and a
 * restore takes an id (never a path).
 */
import { beforeAll, afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { coreCommands, formatRestoreListRows, type SlashCommandContext } from "../src/routes/session/commands"
import type { SessionSeam } from "../src/seams/session"

beforeAll(() => {
  const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
  setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

const ROOT = resolve(import.meta.dir, "../../..")
const RESTORE_KEYS = [
  "command.pruneRestore.description", "command.pruneRestore.unavailable",
  "command.pruneRestore.count", "command.pruneRestore.entry",
  "command.pruneRestore.unknownSize", "command.pruneRestore.rejected",
  "command.pruneRestore.empty", "command.pruneRestore.promptUnavailable",
  "command.pruneRestore.pickTitle", "command.pruneRestore.pickHeader",
  "command.pruneRestore.cancelled", "command.pruneRestore.done",
  "command.pruneRestore.conflict", "command.pruneRestore.failed",
]

interface FakeSeam {
  listPruneRestore?: () => Promise<any>
  restorePrune?: (id: string) => Promise<any>
}
function ctxFor(seam: FakeSeam, pick?: string) {
  const lines: string[] = []
  const ctx = {
    seam: seam as unknown as SessionSeam,
    say: (text: string) => lines.push(text),
    pickOne: async () => pick,
  } as unknown as SlashCommandContext
  return { ctx, lines }
}
const command = () => coreCommands().find((c) => c.name === "/prune-restore")!

describe("/prune-restore", () => {
  test("formatRestoreListRows shows ids/times only — no path", () => {
    const rows = formatRestoreListRows({
      entries: [{ id: "s-1", movedAt: Date.UTC(2026, 10, 20), size: 2048 }],
      rejected: [{ code: "BAD_MANIFEST", message: "bad" }],
    })
    expect(rows.join("\n")).toContain("s-1")
    expect(rows.join("\n")).not.toContain("/home/")
    expect(rows.length).toBe(3)
  })

  test("no arg lists entries then restores the picked id", async () => {
    let restored: string | undefined
    const { ctx, lines } = ctxFor({
      listPruneRestore: async () => ({ entries: [{ id: "s-pick", movedAt: Date.UTC(2026, 10, 20) }], rejected: [] }),
      restorePrune: async (id) => { restored = id; return { id, restored: true, opId: "op" } },
    }, "s-pick")
    await command().run(ctx, "")
    expect(restored).toBe("s-pick")
    expect(lines.join("\n")).toContain("s-pick")
  })

  test("an id argument restores directly without a picker", async () => {
    let restored: string | undefined
    const { ctx } = ctxFor({
      listPruneRestore: async () => ({ entries: [], rejected: [] }),
      restorePrune: async (id) => { restored = id; return { id, restored: true, opId: "op" } },
    })
    await command().run(ctx, "  s-direct  ")
    expect(restored).toBe("s-direct")
  })

  test("CONFLICT gets a dedicated message (no overwrite claim)", async () => {
    const { ctx, lines } = ctxFor({
      listPruneRestore: async () => ({ entries: [], rejected: [] }),
      restorePrune: async () => { throw Object.assign(new Error("live destination exists"), { code: "CONFLICT" }) },
    })
    await command().run(ctx, "s-conflict")
    expect(lines.join("\n")).toMatch(/already exists|已存在/)
  })

  test("empty list stops without calling restore", async () => {
    let called = false
    const { ctx, lines } = ctxFor({
      listPruneRestore: async () => ({ entries: [], rejected: [] }),
      restorePrune: async () => { called = true; return { id: "", restored: true, opId: "" } },
    })
    await command().run(ctx, "")
    expect(called).toBe(false)
    expect(lines.length).toBeGreaterThan(1)
  })
})

describe("B4/C7 locale + ledger", () => {
  test("every restore key exists in both bundled locales", () => {
    for (const locale of ["en.json", "zh-CN.json"]) {
      const table = JSON.parse(readFileSync(resolve(ROOT, "packages/i18n/locales", locale), "utf8"))
      for (const key of RESTORE_KEYS) {
        expect(typeof table[key], `${locale}:${key}`).toBe("string")
        expect(table[key].length).toBeGreaterThan(0)
      }
    }
  })

  test("ledger registers all 15 protocol frames with aligned source lines", () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, "ledger/ledger.json"), "utf8"))
    const wp = ledger.dimensions.wired_protocol
    expect(wp.count).toBe(15)
    expect(wp.methods.length).toBe(15)
    const source = readFileSync(resolve(ROOT, "packages/bridge/src/index.ts"), "utf8").split("\n")
    for (const frame of wp.methods) {
      expect(frame.capir_id).toBeNull()
      expect(frame.source_line).toBeGreaterThan(0)
      expect(source[frame.source_line - 1]).toContain(frame.method)
    }
  })
})
