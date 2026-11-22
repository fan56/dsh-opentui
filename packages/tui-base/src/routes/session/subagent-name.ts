/**
 * Batch F5 — one shared fallback rule for the three subagent row renderers.
 *
 * The host v3 `subagent/catalog` `name` is a sibling-unique CHILD RESERVATION
 * slug, not a registry agent name. On the `use_agent` path `label` already IS
 * the agent name, so painting `name: label` there would repeat it. Render the
 * prefix only when a name exists and differs from the label (ad-hoc children
 * titled with a task are the case it actually helps).
 */

export function subagentNamePrefix(name: string | undefined, label: string): string {
	return name !== undefined && name !== "" && name !== label ? `${name}: ` : ""
}
