/**
 * The dsh-opentui entry Config schema — the plugin's settings surface.
 *
 * The host's dsh-settings SettingsForms.describe() only emits a settings row
 * for plugin entries whose runtime exports a Config schema (schema(entry)
 * reads `entry.fiber.runtime.Config`; entries without one are filtered OUT
 * of describe() entirely). Without this export the `dsh-opentui` settings
 * namespace does not exist at all, so host-session's #refreshRoundLimits
 * always resolved the disabled defaults { maxRounds: 0, maxRoundsGrace: 0 }
 * and the F1 maxRounds hard-stop ladder never fired (observed in the e2e
 * hard-stop scenario: 87 loop rounds, no ladder verdict).
 *
 * Export shape (dsh-tui-pi parity): the cordis-plugin-loader unwraps
 * `exports.default ?? exports` before handing the plugin to the registry,
 * and the entry exports `export default plugin` — so the runtime the host
 * sees is the `plugin` object and Config must ride ON it
 * (host-entry-v2.tsx `plugin = { name, inject, apply, Config }`), not only
 * as a sibling named export. Field names must match the F1 policy readers
 * verbatim: subagent-policy.ts parseSubagentRoundLimits reads `maxRounds` /
 * `maxRoundsGrace` off the `dsh-opentui` namespace row (SUBAGENT_LIMITS_NS),
 * and the e2e hard-stop scenario upserts exactly those keys into the patch
 * entry `id: dsh-opentui`.
 *
 * Defaults mirror DEFAULT_SUBAGENT_ROUND_LIMITS: 0 = disabled —
 * ladderDecision returns "none" for a non-positive cap and pure-soft mode
 * (grace 0) never force-stops, so an untouched install keeps today's
 * behavior. `z.natural()` is schemastery's non-negative integer (no
 * `.int()` chain exists); plain natural rather than range-constrained so a
 * hand-edited out-of-range number cannot get the whole volatile-only update
 * refused.
 *
 * `theme` is deliberately NOT declared: undeclared keys are merged back by
 * schemastery's non-strict object resolve, so the baked patch config's
 * `theme: catppuccin-mocha` still reaches apply(ctx, config) as a plain
 * string (a volatile declaration would hand apply a Volatile reference and
 * break the theme resolution).
 */
import z from "@deepseek-ai/schemastery"

export const Config = z.object({
  maxRounds: z
    .natural()
    .default(0)
    .volatile()
    .description(
      "Global cap on a subagent's LLM round-trips; at the cap a wrap-up is injected. 0 disables the hard-stop policy.",
    ),
  maxRoundsGrace: z
    .natural()
    .default(0)
    .volatile()
    .description(
      "Wrap-up grace rounds after the cap; at cap + grace the child is force-stopped. 0 keeps pure-soft mode (wrap-up only).",
    ),
})
