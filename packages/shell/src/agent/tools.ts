/**
 * The tool set: deliberately small and visible. Every execution goes through
 * the approval gate provided by the caller (the Shell renders it as a card).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { ToolDef } from "./llm.ts"

export const toolDefs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command in the workspace directory. Returns combined stdout/stderr (capped).",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string", description: "the command line" } },
        required: ["cmd"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file (UTF-8), capped to the last 400 lines.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "absolute or workspace-relative path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a text file with the given content.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
]

const MAX_OUTPUT = 6000

export interface ToolRun {
  name: string
  argsPretty: string
  output: string
  ok: boolean
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  opts: { cwd: string },
): Promise<ToolRun> {
  const argsPretty = JSON.stringify(args)
  try {
    if (name === "bash") {
      const cmd = String(args.cmd ?? "")
      const proc = Bun.spawn(["bash", "-c", cmd], { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" })
      const timer = setTimeout(() => proc.kill(), 60_000)
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      clearTimeout(timer)
      const code = await proc.exited
      const text = (out + (err ? (out ? "\n" : "") + err : "")).slice(-MAX_OUTPUT)
      return { name, argsPretty, output: text || `(exit ${code})`, ok: code === 0 }
    }
    if (name === "read_file") {
      const raw = readFileSync(String(args.path), "utf8")
      const lines = raw.split("\n")
      const text = lines.length > 400 ? `…(${lines.length - 400} earlier lines)\n` + lines.slice(-400).join("\n") : raw
      return { name, argsPretty, output: text.slice(-MAX_OUTPUT), ok: true }
    }
    if (name === "write_file") {
      const path = String(args.path)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, String(args.content ?? ""))
      return { name, argsPretty, output: `wrote ${path} (${String(args.content ?? "").length} bytes)`, ok: true }
    }
    return { name, argsPretty, output: `unknown tool: ${name}`, ok: false }
  } catch (e) {
    return { name, argsPretty, output: String(e).slice(0, 500), ok: false }
  }
}
