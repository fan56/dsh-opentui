/**
 * Minimal ambient types for the `ws` package as used by the client transport
 * (constructor with upgrade headers plus the EventEmitter-style surface).
 *
 * Deliberately NOT `@types/ws`: that devDependency would not resolve until the
 * lockfile is synced (`pnpm install`), and this module needs exactly the small
 * surface below. Swap for @types/ws at dependency-sync time if preferred.
 */
declare module "ws" {
	export default class WebSocket {
		constructor(url: string, options?: { headers?: Record<string, string> })
		readonly readyState: number
		send(data: string): void
		close(code?: number, reason?: string): void
		on(event: string, listener: (...args: unknown[]) => void): this
		once(event: string, listener: (...args: unknown[]) => void): this
		removeListener(event: string, listener: (...args: unknown[]) => void): this
	}
}
