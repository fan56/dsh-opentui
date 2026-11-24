// Mux frame parser + `$events` item validation tests.
//
// The parser mirrors dsh-api-gateway's stream-protocol validation: a frame the
// Host would refuse is refused here too, and a malformed `$events` item is
// rejected at the frame boundary.
import { describe, expect, test } from "bun:test"

import {
	openEventsStreamFrame,
	parseEventsItem,
	parseEventsReady,
	parseMuxFrame,
} from "../src/client/mux-frame.ts"

const READY = { type: "ready", clientId: "client-1", host: { home: "/Users/tester" } }
const STREAM_ID = "s-1"

describe("parseMuxFrame", () => {
	test("parses item, value-less item, end, and error frames", () => {
		expect(parseMuxFrame(JSON.stringify({ type: "item", streamId: STREAM_ID, value: { a: 1 } }))).toEqual({
			type: "item",
			streamId: STREAM_ID,
			value: { a: 1 },
		})
		expect(parseMuxFrame(JSON.stringify({ type: "item", streamId: STREAM_ID }))).toEqual({
			type: "item",
			streamId: STREAM_ID,
			value: undefined,
		})
		expect(parseMuxFrame(JSON.stringify({ type: "end", streamId: STREAM_ID }))).toEqual({ type: "end", streamId: STREAM_ID })
		const error = parseMuxFrame(JSON.stringify({ type: "error", streamId: STREAM_ID, error: { code: "c", message: "m", details: {} } }))
		expect(error).toEqual({ type: "error", streamId: STREAM_ID, error: { code: "c", message: "m", details: {} } })
	})

	test("rejects malformed frames", () => {
		for (const text of [
			"not json",
			"[]",
			JSON.stringify({ type: "item" }), // missing streamId
			JSON.stringify({ type: "item", streamId: "" }),
			JSON.stringify({ type: "item", streamId: STREAM_ID, extra: 1, value: null }), // extra key
			JSON.stringify({ type: "end", streamId: STREAM_ID, extra: 1 }),
			JSON.stringify({ type: "error", streamId: STREAM_ID }), // missing error
			JSON.stringify({ type: "error", streamId: STREAM_ID, error: { code: "c", message: "m" } }), // missing details
			JSON.stringify({ type: "error", streamId: STREAM_ID, error: { code: "c", message: 5, details: {} } }),
			JSON.stringify({ type: "bogus", streamId: STREAM_ID }),
		]) {
			expect(() => parseMuxFrame(text), text).toThrow()
		}
	})
})

describe("parseEventsReady (generation gate)", () => {
	test("accepts the exact ready shape", () => {
		expect(parseEventsReady(READY)).toEqual(READY)
	})

	test("rejects non-ready opening items and malformed hosts", () => {
		for (const value of [
			{ type: "emit", event: "x", args: [] }, // events before ready
			{ type: "ready", clientId: "c" }, // missing host
			{ type: "ready", clientId: "c", host: { home: 1 } },
			{ type: "ready", clientId: "", host: { home: "/" } },
			{ type: "ready", clientId: "c", host: { home: "/", extra: 1 } },
			{ type: "ready", clientId: "c", host: { home: "/", }, extra: 1 },
			null,
			"ready",
		]) {
			expect(() => parseEventsReady(value), JSON.stringify(value)).toThrow()
		}
	})
})

describe("parseEventsItem", () => {
	test("accepts emit, waterfall, and cancel items", () => {
		expect(parseEventsItem({ type: "emit", event: "api-session/status", args: [{}, true] })).toEqual({
			type: "emit",
			event: "api-session/status",
			args: [{}, true],
		})
		expect(
			parseEventsItem({
				type: "waterfall",
				event: "approval/request",
				eventId: "e-1",
				agentId: "agent-1",
				request: { requestId: "r-1", payload: { kind: "bash" } },
			}),
		).toMatchObject({ type: "waterfall", eventId: "e-1" })
		expect(parseEventsItem({ type: "cancel", eventId: "e-1" })).toEqual({ type: "cancel", eventId: "e-1" })
	})

	test("rejects malformed items (gateway parity)", () => {
		for (const value of [
			{ type: "emit", event: "x" }, // missing args
			{ type: "emit", event: "", args: [] },
			{ type: "waterfall", event: "x", eventId: "e", agentId: "a", request: { agent: {} } }, // reserved key
			{ type: "waterfall", event: "x", eventId: "e", agentId: "a", request: { signal: 1 } }, // reserved key
			{ type: "waterfall", event: "x", eventId: "", agentId: "a", request: {} },
			{ type: "cancel", eventId: "" },
			{ type: "snapshot", data: 1 }, // unknown type
			42,
			"emit",
		]) {
			expect(() => parseEventsItem(value), JSON.stringify(value)).toThrow()
		}
	})
})

describe("openEventsStreamFrame", () => {
	test("matches the documented open payload", () => {
		expect(openEventsStreamFrame("abc")).toEqual({ type: "open", streamId: "abc", endpoint: "$events", payload: { args: {} } })
	})
})
