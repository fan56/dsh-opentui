/**
 * Client-local git probe for the client-mode session layer (ADR-0005
 * bucket (b) wave 3; audit row 39).
 *
 * No VCS namespace exists on the Remote surface (audit gap 4); in the
 * single-machine topology the powerline git segment keeps its local
 * `git` probe — the exact semantics of ShellHost.tsx:277-295:
 * `git branch --show-current` in the workspace directory (the TUI's
 * launch cwd), 3s timeout, silent ("") on non-repos and on a missing
 * binary. The renderer keeps running its own identical probe; this helper
 * is the testable seam for the facade and the live smoke.
 */

import { execFile } from "node:child_process"

/**
 * Current branch name of the repo at `cwd` ("" outside a repo / on any
 * failure — an empty segment is the documented silent degrade).
 */
export function probeGitBranch(cwd: string, timeoutMs = 3000): Promise<string> {
	return new Promise((resolve) => {
		execFile("git", ["branch", "--show-current"], { cwd, timeout: timeoutMs }, (err, stdout) => {
			resolve(err ? "" : String(stdout).trim())
		})
	})
}
