/**
 * Attachments for the client-mode session layer (ADR-0005 bucket (b)
 * wave 3; audit rows 35 + 36).
 *
 * Wire facts (installed closure, dsh 0.2.1-rc.5) and the route CHOICE for
 * `/attach` (the audit offers receipts OR inline image parts — pick per
 * wire, say why):
 *
 * - READ-BACK WIRE (installed closure, dsh 0.2.2-rc.2 typert.host.js):
 *   `session/attachment` takes ONE parameter named `request` of shape
 *   `{sessionId, attachment: ImageAttachmentRef}` — the nested ref needs
 *   `attachmentId` + `mediaType` + `bytes` + `width` + `height` (all
 *   required; strict codec, `additionalProperties: false`). The admitted
 *   prompt-content blocks in the follow journal carry exactly that ref.
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
 * (`attachmentRefsOfPromptContent`) for the round-trip surface.
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
 * The admitted image refs inside one durable prompt content array (the
 * host promotes inline bytes to `{type:'image', attachment:
 * ImageAttachmentRef}` before the message is created). The refs pass
 * through verbatim — `session/attachment` verifies the full ref
 * (attachmentId + mediaType + bytes + width + height), not just the id.
 */
export function attachmentRefsOfPromptContent(content: unknown): Record<string, unknown>[] {
	const refs: Record<string, unknown>[] = []
	if (!Array.isArray(content)) return refs
	for (const block of content) {
		const typed = block as { type?: unknown; attachment?: unknown } | null
		if (typed?.type !== "image" || typeof typed.attachment !== "object" || typed.attachment === null) continue
		const ref = typed.attachment as Record<string, unknown>
		if (typeof ref.attachmentId === "string" && ref.attachmentId) refs.push(ref)
	}
	return refs
}

/**
 * The admitted attachment ids inside one durable prompt content array
 * (durable read-back input; the ids of `attachmentRefsOfPromptContent`).
 */
export function attachmentIdsOfPromptContent(content: unknown): string[] {
	return attachmentRefsOfPromptContent(content).map((ref) => ref.attachmentId as string)
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
 * plus the normalized ref the host stored. The wire parameter is the FULL
 * admitted ref (`{request:{sessionId, attachment}}` per the host typert
 * descriptor) — an id-only request is rejected `gateway/input-invalid`.
 */
export async function readSessionAttachment(
	rpc: RemoteAttachmentRpc,
	sessionId: string,
	attachment: Record<string, unknown>,
): Promise<{ data: string; mediaType: string; bytes: number; width?: number; height?: number }> {
	const value = (await rpc("session/attachment", { request: { sessionId, attachment } })) as Record<string, unknown>
	const ref = (typeof value.attachment === "object" && value.attachment !== null ? value.attachment : {}) as Record<string, unknown>
	return {
		data: typeof value.data === "string" ? value.data : "",
		mediaType: typeof ref.mediaType === "string" ? ref.mediaType : "",
		bytes: typeof ref.bytes === "number" ? ref.bytes : 0,
		...(typeof ref.width === "number" ? { width: ref.width } : {}),
		...(typeof ref.height === "number" ? { height: ref.height } : {}),
	}
}
