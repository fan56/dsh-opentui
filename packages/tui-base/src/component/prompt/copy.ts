/**
 * Composer selection → clipboard copy.
 *
 * Kept free of renderer/Solid imports so the copy decision can be unit-tested
 * with plain mocks. The caller wires this to the `input.copy` command bound to
 * ctrl+c / super+c; with no selection it returns false and leaves the event to
 * the existing clear/exit path untouched.
 */
export type CopySelectionSource = {
  hasSelection(): boolean
  getSelectedText(): string
}

export type CopyClipboard = {
  write(text: string): Promise<void>
}

/** Returns true only when a copy was actually issued. */
export function copyComposerSelection(
  source: CopySelectionSource,
  clipboard: CopyClipboard,
  onError: (error: unknown) => void = () => {},
): boolean {
  if (!source.hasSelection()) return false
  void clipboard.write(source.getSelectedText()).catch(onError)
  return true
}
