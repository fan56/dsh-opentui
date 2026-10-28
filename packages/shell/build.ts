// compile the shell into a standalone binary (official @opentui/solid path)
import solidPlugin from "@opentui/solid/bun-plugin"

const target = process.argv[2] ?? "bun-darwin-arm64"
const result = await Bun.build({
  entrypoints: ["./src/main.tsx"],
  target: "bun",
  outdir: "../../build",
  plugins: [solidPlugin],
  compile: { target: target as any, outfile: `dsh-opentui-${target.replace("bun-", "")}` },
})
if (!result.success) {
  for (const l of result.logs) console.error(l)
  process.exit(1)
}
console.log(`compiled -> build/dsh-opentui-${target.replace("bun-", "")}`)
