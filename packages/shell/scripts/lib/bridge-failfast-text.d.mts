/** Type declarations for bridge-failfast-text.mjs (shared by the client TS
 * program and the provision script). Kept beside the .mjs so `tsc` with
 * moduleResolution: bundler resolves the string constants without allowJs. */

export declare const BRIDGE_REPAIR_COMMAND: string
export declare const BRIDGE_APPEND_PRESET_NOTICE: string
export declare const BRIDGE_REPAIR_HINT: string

export declare function formatBridgeFailFastMessage(
  diagnosis: string,
  repairCommand?: string,
): string
