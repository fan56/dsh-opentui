/** A decoded `response{ok:false,error}` frame. `code` is the ADR-0010 code. */
export class BridgeProtocolError extends Error {
	readonly code: string
	readonly detail?: unknown

	constructor(code: string, message: string, detail?: unknown) {
		super(message)
		this.name = "BridgeProtocolError"
		this.code = code
		if (detail !== undefined) this.detail = detail
	}
}
