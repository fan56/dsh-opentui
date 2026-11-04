/**
 * executionMode discriminator for the client-mode session layer (ADR-0005
 * bucket (b) wave 3; audit row 37).
 *
 * The in-process badge reads the LIVE agent's tool registry: under a `ptc`
 * presentation every capability collapses into the reserved `run_code`
 * transport, which `tools.schemas()` lists for exactly that case
 * (host-session.ts:774-783). No remote face exposes tool schemas.
 *
 * What the wire DOES expose, and why one of the two is a reliable
 * discriminator:
 *
 * - `agentPresets/read` → AgentPresetDocument.content: "The declared child
 *   plugin list as entry-list YAML, `!!js` expressions included" — the
 *   preset composition WITH each row's config (js-yaml dump of the
 *   entry list, one key per line). A preset that owns its presentation
 *   carries a `tool-presentation` row (`dsh-agent-tool-presentation`,
 *   config `{mode: 'native' | 'ptc'}`), and that row shadows the
 *   deployment default for every agent joined to the preset. This IS the
 *   in-process shadowing rule, so scanning the document reproduces the
 *   badge for preset-bound sessions.
 * - `pluginInventory/list` → PluginInventorySnapshot: module rows with
 *   enablement/fiberPhase but NO config — the presence of a
 *   tool-presentation entry says nothing about its mode (and per
 *   host-session.ts:772-773, mounting a ptc/codemode plugin does not
 *   change the main agent's presentation). NOT usable.
 *
 * Verdict contract (no guessing):
 * - document has a tool-presentation row with `mode: native|ptc` → that
 *   mode (authoritative for the preset-bound session);
 * - row present but its mode unreadable → undefined (inconclusive — the
 *   caller keeps the previous verdict and logs);
 * - NO tool-presentation row → undefined: the agent runs the deployment
 *   default composition, whose mode is not queryable over the wire (the
 *   inventory carries no config). The deployment default in a composition
 *   without a tool-presentation row is `native`, so the caller keeps
 *   "native" — documented as the one assumption this probe cannot close
 *   (a deployment that mounts a GLOBAL ptc tool-presentation row outside
 *   any preset would be mislabeled native until a host-side mode surface
 *   exists — audit §4 candidate).
 */

/**
 * Scan one `agentPresets/read` document (entry-list YAML) for the
 * `tool-presentation` row's configured mode. Handles the canonical
 * js-yaml dump shape: top-level `- ` rows, row keys indented one level,
 * `config:` blocks nested deeper (groups nest further — every `- ` line
 * opens a row block regardless of depth).
 */
export function toolPresentationModeFromPresetDocument(content: string): "native" | "ptc" | undefined {
	const rows: string[][] = []
	for (const line of content.split("\n")) {
		const stripped = line.trim()
		if (stripped === "" || stripped.startsWith("#")) continue
		if (/^-(?:\s|$)/.test(stripped)) rows.push([line])
		else if (rows.length > 0) rows[rows.length - 1]!.push(line)
	}
	for (const block of rows) {
		const first = block[0]!.trim()
		// row identity: `- name: ...` on the dash line, or a `name:` key
		// anywhere in the row's own key level (one indent under the dash)
		const nameLine = /^-name:/.test(first.replace(/^-\s+/, "-"))
			? first
			: block.find((l) => {
					const m = /^\s{2,}name:\s*(.+)$/.exec(l)
					return m !== null && m !== undefined
				})
		const nameText = (() => {
			if (nameLine === undefined) return undefined
			const inline = /^\s*-\s+name:\s*(.+)$/.exec(nameLine)
			if (inline) return inline[1]
			const keyed = /^\s{2,}name:\s*(.+)$/.exec(nameLine)
			return keyed ? keyed[1] : undefined
		})()
		if (nameText === undefined) continue
		const name = nameText.trim().replace(/^["']|["']$/g, "")
		if (!name.includes("tool-presentation")) continue
		// the row's mode: the `mode:` key inside this row's config block
		for (const line of block) {
			const m = /^\s+mode:\s*(.+)$/.exec(line)
			if (!m) continue
			const raw = m[1]!.trim().replace(/^["']|["']$/g, "")
			if (raw === "native" || raw === "ptc") return raw
			return undefined // row present, mode unreadable — inconclusive
		}
		return undefined // row present without a mode key — inconclusive
	}
	return undefined // no tool-presentation row — deployment default
}
