/**
 * Entry-side assembly for the slash host (verification gate, 2026-11).
 *
 * WHY THIS MODULE EXISTS. The /agents incident: `examples/v2-entry.tsx`
 * passed `openAgents` into `createSlashHost`, but the deps type (and the
 * ctx spread inside the host) did not carry it, so `ctx.openAgents` stayed
 * undefined and `/agents` answered "the manager panel is not mounted in
 * this entry". The entry file sits behind `@ts-nocheck` (it composes
 * shell's untyped client classes), so tsc never saw the excess property;
 * the command-level tests hand-build a ctx, so they could never see the
 * missing wire either.
 *
 * This module makes the wiring one typed, renderer-free function:
 *   - `SlashHostDeps` is the host's single entry gate (slash-palette.tsx).
 *   - `ENTRY_SLASH_HOOKS` enumerates every optional hook the ENTRY must
 *     supply. The assertion below fails to compile when a hook is added to
 *     `SlashHostDeps` but not listed here (漏声明), and `buildSlashDeps`
 *     requires all of them (漏传) for any typechecked caller.
 *   - `buildSlashDeps` is a pure object assembly — no rendering, no seam
 *     calls — so `test/entry-slash-deps.test.ts` exercises the REAL wiring
 *     path with sentinels instead of hand-rolling a ctx.
 *
 * Residual gap (documented in docs/verification-gates.md): v2-entry.tsx
 * itself stays `@ts-nocheck`, so the call site's argument object is not
 * compiler-checked. The source-level contract test in
 * `test/agents-mount-entry.test.ts` plus the identity test here cover the
 * entry half; move the call into a checked module if the entry ever loses
 * ts-nocheck.
 */
import type { SlashCommandContext } from "./commands"
import type { SlashHostDeps } from "./slash-palette"

/**
 * Every optional hook the entry must hand to the slash host. Keep this list
 * exhaustive: the assertions below turn a missing entry into a compile error
 * on BOTH sides — the deps bag (`SlashHostDeps`) and the dispatch contract
 * (`SlashCommandContext`).
 */
export const ENTRY_SLASH_HOOKS = [
	"promptText",
	"openBtw",
	"themes",
	"openSearch",
	"openPlugins",
	"openAgents",
	"refreshFooter",
	"invalidateFooter",
] as const satisfies readonly (keyof SlashHostDeps & keyof SlashCommandContext)[]

export type EntrySlashHook = (typeof ENTRY_SLASH_HOOKS)[number]

/** The hooks the entry must supply, all required. */
export type EntrySlashHooks = Required<Pick<SlashHostDeps, EntrySlashHook>>

/** Everything the host takes EXCEPT the entry hooks (seam + core callbacks). */
export type SlashBaseDeps = Omit<SlashHostDeps, EntrySlashHook>

/**
 * Optional keys of a shape (the ones an entry/host can forget).
 *
 * Only OPTIONAL keys need this list: a new REQUIRED key on `SlashHostDeps` is
 * caught by the `const ctx: SlashCommandContext = { … }` literal in
 * `createSlashHost` — a required context field missing from that object is a
 * compile error, so it cannot silently stop at the deps→ctx boundary.
 */
type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T]

type UnlistedDepsHook = Exclude<OptionalKeys<SlashHostDeps>, "commands" | EntrySlashHook>
type UnlistedContextHook = Exclude<OptionalKeys<SlashCommandContext>, EntrySlashHook>

/**
 * `commands?:` is a test-only registry override, not an entry hook, so the
 * exhaustive-list assertions exclude it. Extending either contract with a new
 * optional hook and forgetting the list is a compile error here.
 */
type AllEntryHooksListed = UnlistedDepsHook extends never
	? UnlistedContextHook extends never
		? true
		: ["unlisted slash context hook:", UnlistedContextHook]
	: ["unlisted slash deps hook:", UnlistedDepsHook]
const _allEntryHooksListed: AllEntryHooksListed = true

/**
 * Assemble the `createSlashHost` deps from an entry's base callbacks and its
 * hook set. Pure — safe to call from tests with sentinels.
 */
export function buildSlashDeps(base: SlashBaseDeps, hooks: EntrySlashHooks): SlashHostDeps {
	// Touch the assertion so `noUnusedLocals` is satisfied while keeping the
	// compile-time exhaustiveness check live.
	void _allEntryHooksListed
	return {
		...base,
		promptText: hooks.promptText,
		openBtw: hooks.openBtw,
		themes: hooks.themes,
		openSearch: hooks.openSearch,
		openPlugins: hooks.openPlugins,
		openAgents: hooks.openAgents,
		refreshFooter: hooks.refreshFooter,
		invalidateFooter: hooks.invalidateFooter,
	}
}

/**
 * Carry the defined hooks from the host deps into the dispatch ctx. This is
 * the SECOND half of the /agents root cause: the deps type carried a hook but
 * `createSlashHost` built `SlashCommandContext` from a hand-written spread
 * list that silently missed it. The list is now shared and exhaustiveness is
 * compile-checked, so a declared hook cannot stop at this boundary.
 */
export function carrySlashHooks(deps: SlashHostDeps): Partial<SlashCommandContext> {
	const ctx: Partial<SlashCommandContext> = {}
	for (const key of ENTRY_SLASH_HOOKS) {
		const value = deps[key]
		if (value !== undefined) (ctx as Record<string, unknown>)[key] = value
	}
	return ctx
}
