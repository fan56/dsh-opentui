/**
 * B1 S3 — provisioner runtime-field merge (design 05 §4.3(a)).
 *
 * The host config service writes volatile scalars into the inproc profile patch
 * at runtime. provisionPatch() rewrites that file from its embedded template on
 * every launch; without a field-level merge the runtime value is lost on the
 * next restart. This module performs a LINE-BASED merge of an allow-listed set
 * of volatile scalars into a fresh template copy.
 *
 * Deliberately NOT a YAML parse/serialize round-trip: the template carries
 * `!!js` tags (DSH_OPENTUI_APPROVAL_GATE escape hatch) that a plain loader
 * cannot reproduce, and a full rewrite would reorder/requote unrelated lines.
 * Only the exact matched line is replaced; every other byte is preserved.
 *
 * Pure + env-independent: no fs, no clock, no process.env reads. The caller
 * supplies both texts; tests drive it with a temp-dir fixture.
 */

/** Match a whitelisted scalar line anchored to a whole line (no substring hits). */
const MAX_ACTIVE_RE = /^([ \t]*)maxActiveSubagents:([ \t]*)(\S.*?)[ \t]*$/gm
const DEFAULT_PRESET_RE = /^([ \t]*)defaultPreset:([ \t]*)(\S.*?)[ \t]*$/gm

function allMatches(text, re) {
  re.lastIndex = 0
  return [...text.matchAll(re)]
}

/** Validate an unquoted YAML scalar is a safe identifier/number, not an injection. */
function safeScalar(raw) {
  const value = raw.trim()
  const core = value.replace(/^(['"])(.*)\1$/, '$2')
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(core) ? value : undefined
}

/** Replace exactly one line in `text`; bail out if the needle is not unique. */
function replaceOnce(text, needle, replacement) {
  const count = text.split(needle).length - 1
  if (count !== 1) return { text, ok: false, count }
  return { text: text.replace(needle, replacement), ok: true, count: 1 }
}

/** Locate the single `enabled:` line inside a top-level `- id: <id>` sequence item.
 *  Scoped to the entry block so the approval-gate `enabled: !!js ...` line (a
 *  different entry) is never mistaken for session-log-deepseek's boolean. */
function findEntryEnabled(text, id) {
  const idRe = new RegExp(`^- id: ${id}[ \\t]*$`, 'm')
  const idMatch = idRe.exec(text)
  if (idMatch === null) return undefined
  const blockStart = idMatch.index + idMatch[0].length
  const rest = text.slice(blockStart)
  const nextEntry = /^- (?:id|insert):/m.exec(rest)
  const blockEnd = nextEntry === null ? text.length : blockStart + nextEntry.index
  const block = text.slice(blockStart, blockEnd)
  const re = /^([ \t]*)enabled:([ \t]*)(\S.*?)[ \t]*$/gm
  const matches = allMatches(block, re)
  if (matches.length !== 1) return undefined // absent or duplicate → refuse
  const m = matches[0]
  return { absoluteIndex: blockStart + m.index, full: m[0], indent: m[1], gap: m[2], value: m[3] }
}

/** Accept only a boolean scalar (bare or quoted), never an expression/injection. */
function safeBoolean(raw) {
  const core = raw.trim().replace(/^(['"])(.*)\1$/, '$2')
  return core === 'true' || core === 'false' ? core : undefined
}

/**
 * Merge runtime-written volatile fields from `current` into a fresh `template`.
 *
 * @returns {{content: string, mergedFields: string[], notes: string[]}}
 *   content      - template with allow-listed runtime values substituted in
 *   mergedFields - field ids actually carried over (empty when none)
 *   notes        - WARN lines for the caller to surface (guard/skip decisions)
 */
export function mergeRuntimeFields(template, current) {
  const out = { content: template, mergedFields: [], notes: [] }
  if (typeof current !== 'string' || current.length === 0) return out

  // --- subagent.maxActiveSubagents ------------------------------------------
  {
    const tmpl = allMatches(template, MAX_ACTIVE_RE)
    const curr = allMatches(current, MAX_ACTIVE_RE)
    // Exactly one template line and one current line; duplicates are refused
    // rather than guessed (design §8.1.2: bad indent / duplicate key -> WARN).
    if (tmpl.length === 1 && curr.length === 1) {
      const tmplValue = tmpl[0][3]
      const currRaw = curr[0][3]
      const currValue = safeScalar(currRaw)
      if (currValue !== undefined && /^\d+$/.test(currValue) && currValue !== tmplValue) {
        const needle = tmpl[0][0]
        const replacement = `${tmpl[0][1]}maxActiveSubagents:${tmpl[0][2]}${currValue}`
        const res = replaceOnce(out.content, needle, replacement)
        if (res.ok) {
          out.content = res.text
          out.mergedFields.push('subagent.maxActiveSubagents')
        } else {
          out.notes.push('subagent.maxActiveSubagents: template line not unique; runtime value not merged')
        }
      } else if (currRaw !== tmplValue) {
        out.notes.push('subagent.maxActiveSubagents: runtime value failed the scalar allow-list; template value kept')
      }
    } else if (curr.length > 1) {
      out.notes.push('subagent.maxActiveSubagents: duplicate lines in current patch; runtime value not merged')
    }
  }

  // --- permission.defaultPreset (with !!js escape-hatch guard) --------------
  {
    const tmpl = allMatches(template, DEFAULT_PRESET_RE)
    const curr = allMatches(current, DEFAULT_PRESET_RE)
    if (tmpl.length === 1 && curr.length === 1) {
      const tmplValue = tmpl[0][3]
      const currValue = curr[0][3]
      // Guard: current still carries the template's !!js expression -> the
      // DSH_OPENTUI_APPROVAL_GATE escape hatch is intact; leave it alone.
      if (currValue !== tmplValue) {
        const plain = safeScalar(currValue)
        if (plain !== undefined && !currValue.includes('!!js')) {
          const needle = tmpl[0][0]
          const replacement = `${tmpl[0][1]}defaultPreset:${tmpl[0][2]}${plain}`
          const res = replaceOnce(out.content, needle, replacement)
          if (res.ok) {
            out.content = res.text
            out.mergedFields.push('permission.defaultPreset')
            out.notes.push(
              `permission.defaultPreset: runtime plain scalar ${plain} overrides the template !!js DSH_OPENTUI_APPROVAL_GATE escape hatch; merged as plain value`,
            )
          } else {
            out.notes.push('permission.defaultPreset: template line not unique; runtime value not merged')
          }
        } else {
          out.notes.push('permission.defaultPreset: runtime value failed the scalar allow-list; template !!js line kept')
        }
      }
    } else if (curr.length > 1) {
      out.notes.push('permission.defaultPreset: duplicate lines in current patch; runtime value not merged')
    }
  }

  // --- session-log-deepseek.enabled (boolean, entry-scoped) ------------------
  {
    const tmpl = findEntryEnabled(template, 'session-log-deepseek')
    const curr = findEntryEnabled(current, 'session-log-deepseek')
    if (tmpl !== undefined && curr !== undefined) {
      const tmplValue = tmpl.value.trim()
      const currValue = curr.value.trim()
      // B1 S4-S6 / design 05 §4.3a: carry the host-written boolean across
      // launcher restarts. A `!!js` expression or any non-boolean is refused
      // (same scalar allow-list discipline as the other two fields).
      if (currValue !== tmplValue) {
        const plain = safeBoolean(currValue)
        if (plain !== undefined) {
          const needle = tmpl.full
          const replacement = `${tmpl.indent}enabled:${tmpl.gap}${plain}`
          const res = replaceOnce(out.content, needle, replacement)
          if (res.ok) {
            out.content = res.text
            out.mergedFields.push('session-log-deepseek.enabled')
          } else {
            out.notes.push('session-log-deepseek.enabled: template line not unique; runtime value not merged')
          }
        } else {
          out.notes.push('session-log-deepseek.enabled: runtime value failed the boolean allow-list; template value kept')
        }
      }
    } else if (curr === undefined && /^- id: session-log-deepseek[ \t]*$/m.test(current)) {
      out.notes.push('session-log-deepseek.enabled: duplicate or missing enabled line in current patch; runtime value not merged')
    }
  }

  return out
}
