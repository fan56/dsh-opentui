export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  /**
   * DEPRECATED for faces that switch `borderStyle` (skin contract §2.4):
   * these chars have empty corners / blank horizontals, so they collide
   * with a real border style (e.g. the composer's heavy focus frame).
   * Such faces must NOT pass this — see session-composer.tsx. The field
   * stays for the legacy split-border consumers (old routes, toast) that
   * never change borderStyle.
   */
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
}
