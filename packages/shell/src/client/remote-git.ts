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

/**
 * Branch name, or the short SHA on a detached HEAD (composer-context
 * batch): `git rev-parse --abbrev-ref HEAD` names the branch, and answers
 * the literal "HEAD" when detached — that second probe then reads
 * `git rev-parse --short HEAD`. "" outside a repo / on any failure (the
 * documented silent degrade, same contract as probeGitBranch).
 */
export function probeGitBranchOrSha(cwd: string, timeoutMs = 3000): Promise<string> {
	return new Promise((resolve) => {
		execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: timeoutMs }, (err, stdout) => {
			if (err) return resolve("")
			const ref = String(stdout).trim()
			if (ref === "") return resolve("")
			if (ref !== "HEAD") return resolve(ref)
			execFile("git", ["rev-parse", "--short", "HEAD"], { cwd, timeout: timeoutMs }, (err2, out2) => {
				resolve(err2 ? "" : String(out2).trim())
			})
		})
	})
}
