/**
 * Attachments for the client-mode session layer (ADR-0005 bucket (b)
 * wave 3; audit rows 35 + 36).
 *
 * Wire facts (installed closure, dsh 0.2.1-rc.5) and the route CHOICE for
 * `/attach` (the audit offers receipts OR inline image parts — pick per
 * wire, say why):
 *
 * - `fileUploads/upload` {agentId, request:{data, name?}} mints a receipt
 *   carrying a FileAttachmentRef (verbatim file store). BUT the prompt
 *   `{type:'file', receiptId}` part resolves to a FILE reference, and the
 *   read-back RPC `session/attachment` serves admitted IMAGE references
 *   only (ImageAttachmentRef) — live-verified: a file-part prompt answers
 *   `session/attachment-invalid` / ATTACHMENT_NOT_REFERENCED on read-back.
 *   The receipt route also needs an agent-scoped upload per target
 *   session (a staged receipt goes stale across /new/abort).
 * - The INLINE image part `{type:'image', mediaType, data: base64,
 *   name?}` is admitted by the host through
 *   `ctx.attachments.admitPromptContent()` BEFORE the message is created,
 *   producing the durable ImageAttachmentRef that `session/attachment`
 *   reads back. That is the exact property HostSession's attachImage
 *   documents (bytes land in $DSH_HOME/attachments; the message carries
 *   the ref), with no stale-receipt window and no extra RPC.
 *
 * Chosen route: the inline image part. The admitted refs are read from
 * the follow journal's durable user/message records
 * (`attachmentIdsOfPromptContent`) for the round-trip surface.
 *
 * Row 36: `GET /api/file?path=<absolute path>` (mounted by
 * SessionMediaReferences, authenticated by the API cookie, 20 MiB cap →
 * 413) reads ANY host-side file — the tool-result image bytes path.
 */

import { readFile } from "node:fs/promises"

/** Raster formats accepted by the v1 attachment path (HostSession parity). */
export const IMAGE_MEDIA_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
}

/** One staged image ready for the next prompt's inline image part. */
export interface StagedImageUpload {
	/** Canonical base64 of the exact file bytes. */
	data: string
	mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
	/** Display leaf name (path stripped — never interpreted as a path). */
	name: string
	bytes: number
}

/**
 * Read + validate a local image for staging (host-session.ts:1153-1163
 * parity: extension allowlist, whole-file read, leaf display name).
 */
export async function readImageAttachment(path: string): Promise<StagedImageUpload> {
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
	const mediaType = IMAGE_MEDIA_TYPES[ext]
	if (!mediaType) throw new Error(`unsupported image type .${ext} (png/jpg/webp/gif)`)
	const data = await readFile(path)
	const leaf = path.split("/").pop() ?? path
	return { data: Buffer.from(data).toString("base64"), mediaType, name: leaf, bytes: data.byteLength }
}

/** Unary RPC carrier (the ClientConnection subset used here). */
export type RemoteAttachmentRpc = (method: string, args?: Record<string, unknown>) => Promise<unknown>

/** The wire `PromptContentPart` image shape (session-controller types). */
export interface RemoteImagePromptPart {
	type: "image"
	mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
	data: string
	name?: string
}

/** The staged image as the next prompt's inline image part. */
export function imagePromptPart(file: StagedImageUpload): RemoteImagePromptPart {
	return { type: "image", mediaType: file.mediaType, data: file.data, ...(file.name ? { name: file.name } : {}) }
}

/**
 * The admitted attachment ids inside one durable prompt content array
 * (the host promotes inline bytes to `{type:'image', attachment:
 * ImageAttachmentRef}` before the message is created).
 */
export function attachmentIdsOfPromptContent(content: unknown): string[] {
	const ids: string[] = []
	if (!Array.isArray(content)) return ids
	for (const block of content) {
		const typed = block as { type?: unknown; attachment?: unknown } | null
		if (typed?.type !== "image" || typeof typed.attachment !== "object" || typed.attachment === null) continue
		const attachmentId = (typed.attachment as Record<string, unknown>).attachmentId
		if (typeof attachmentId === "string" && attachmentId) ids.push(attachmentId)
	}
	return ids
}

/** Typed failures of the /api/file bytes path. */
export class HostFileError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "HostFileError"
	}
}

/**
 * Fetch one host-side file's bytes through the authenticated
 * `GET /api/file?path=` route (row 36: tool-result image bytes). 20 MiB
 * host cap; larger files answer 413 (HostFileError "too large").
 */
export async function fetchHostFile(baseUrl: string, cookieHeader: string, path: string): Promise<Uint8Array> {
	const url = `${baseUrl.replace(/\/$/, "")}/api/file?path=${encodeURIComponent(path)}`
	let response: Response
	try {
		response = await fetch(url, { headers: { cookie: cookieHeader } })
	} catch (error) {
		throw new HostFileError(`GET /api/file failed: ${error instanceof Error ? error.message : String(error)}`)
	}
	if (response.status === 413) throw new HostFileError(`${path}: exceeds the host /api/file cap (20 MiB)`)
	if (!response.ok) throw new HostFileError(`GET /api/file ${path}: HTTP ${response.status}`)
	return new Uint8Array(await response.arrayBuffer())
}

/**
 * Read one durable image back (round-trip verification): base64 payload
 * plus the normalized ref the host stored.
 */
export async function readSessionAttachment(
	rpc: RemoteAttachmentRpc,
	sessionId: string,
	attachmentId: string,
): Promise<{ data: string; mediaType: string; bytes: number; width?: number; height?: number }> {
	const value = (await rpc("session/attachment", { request: { sessionId, attachmentId } })) as Record<string, unknown>
	const ref = (typeof value.attachment === "object" && value.attachment !== null ? value.attachment : {}) as Record<string, unknown>
	return {
		data: typeof value.data === "string" ? value.data : "",
		mediaType: typeof ref.mediaType === "string" ? ref.mediaType : "",
		bytes: typeof ref.bytes === "number" ? ref.bytes : 0,
		...(typeof ref.width === "number" ? { width: ref.width } : {}),
		...(typeof ref.height === "number" ? { height: ref.height } : {}),
	}
}
