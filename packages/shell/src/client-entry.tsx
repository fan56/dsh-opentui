/**
 * Client-mode entry (ADR-0005): the TUI as a thin rendering client.
 *
 * T9: the HTTP host boot chain is gone. `main()` injects a StdioBridgeTransport
 * into tui-base's `bootClientV2`, which builds the BridgeSessionSeam directly.
 * The old `bootClient()` seam (ensureHost → ClientConnection →
 * RemoteHostSession → ShellHost) and its exported helpers were removed with
 * the HTTP modules they depended on.
 *
 * The v2 entry resolves at RUNTIME (non-literal dynamic import) on purpose:
 * it lives outside this package's tsconfig include so the vendored view graph
 * never enters shell's tsc program, and the file lives under tui-base per the
 * batch-9a resolution law (babel-processed in tui-base's own context).
 *
 * The solid transform (`@opentui/solid`'s bun preload) is installed by the
 * ROOT LAUNCHER's `--preload` flag, not by an import here.
 */
async function main(): Promise<void> {
	try {
		// Computed specifier: opaque to tsc while bun resolves it relative
		// to this file through the normal loader.
		const v2Specifier = "../../" + "tui-base/examples/v2-entry.tsx"
		const mod = (await import(v2Specifier)) as {
			bootClientV2(options?: {
				argv?: readonly string[]
				bridgeTransport?: {
					request(method: string, params?: Record<string, unknown>): Promise<unknown>
					onEvent(listener: (event: { type: string; payload: unknown }) => void): () => void
					close?(): void
				}
				bridgeCtx?: { logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void } }
			}): Promise<{ shutdown(): Promise<void> }>
		}
		const argv = process.argv.slice(2)
		// The bridge is the SOLE seam. StdioBridgeTransport is constructed here
		// and unconditionally injected into the synthetic root.
		const bridgeMod = await import("./client/bridge-transport.ts")
		await mod.bootClientV2({
			argv,
			bridgeTransport: new bridgeMod.StdioBridgeTransport(),
			bridgeCtx: { logger: console },
		})
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
		process.stderr.write(`dsh-opentui client boot failed: ${message}\n`)
		process.exit(1)
	}
}

if (import.meta.main) {
	void main()
}
