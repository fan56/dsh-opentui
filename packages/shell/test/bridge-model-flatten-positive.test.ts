/**
 * S1 review concern C2 — positive UI path coverage (carried into S2).
 *
 * Before this file: bridge-session-seam.test.ts tested ONLY the UNSUPPORTED
 * degrade for modelCatalog/selectModel; no case drove the positive `groups`
 * → rows flatten. This file adds that missing positive-path assertion using the
 * same transport-harness discipline, WITHOUT changing any existing assertion.
 *
 * Layers covered:
 *  - bridge reply shape (groups array as returned by handleLine's projection)
 *  - seam positive flatten (groups → SeamProviderModel[] rows)
 *  - malformed groups skipped (never flattened into a fake row)
 */
import { describe, expect, test } from "bun:test"
import { BridgeSessionSeam, type BridgeTransport } from "../src/client/bridge-session-seam.ts"

function seamWithReply(reply: unknown) {
  const requests: Array<{ method: string }> = []
  const transport: BridgeTransport = {
    async request(method: string) { requests.push({ method }); return reply },
    onEvent() { return () => {} },
  }
  const logger = { info() {}, warn() {}, error() {}, debug() {} }
  const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
  return { seam, requests }
}

describe("C2 — positive model flatten (groups → rows)", () => {
  test("modelCatalog flattens provider groups into {providerID, modelID} rows", async () => {
    const { seam, requests } = seamWithReply({
      default: { provider: "p1", model: "m1" },
      groups: [
        { id: "provider-a", models: [{ id: "model-a1" }, { id: "model-a2" }] },
        { id: "provider-b", models: [{ id: "model-b1" }] },
      ],
    })
    const rows = await seam.modelCatalog()
    expect(rows).toEqual([
      { providerID: "provider-a", modelID: "model-a1" },
      { providerID: "provider-a", modelID: "model-a2" },
      { providerID: "provider-b", modelID: "model-b1" },
    ])
    expect(requests.map((r) => r.method)).toContain("modelCatalog")
  })

  test("malformed groups/models are skipped, never flattened into fake rows", async () => {
    const { seam } = seamWithReply({
      groups: [
        { id: "", models: [{ id: "orphan" }] },          // no provider id → skip group
        { id: "p-good", models: [{ id: "" }, { name: "no-id" }, { id: "m-good" }] },
        { models: [{ id: "m-noprovider" }] },            // no id → skip
      ],
    })
    const rows = await seam.modelCatalog()
    expect(rows).toEqual([{ providerID: "p-good", modelID: "m-good" }])
  })

  test("wire-frame value wrapping `{value}` without groups still degrades UNSUPPORTED", async () => {
    const { seam } = seamWithReply({ value: { provider: "p", model: "m" } })
    await expect(seam.modelCatalog()).rejects.toMatchObject({ code: "UNSUPPORTED" })
  })
})
