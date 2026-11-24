/**
 * Patch ownership / convergence — pure functions (design 06, R0–R29, T3).
 *
 * No fs, no clock, no env reads. The caller supplies `template`, `current`,
 * `sidecar` and `templateRevision`; every result is a plain value so the
 * provisioner (T4) decides the exit code and the atomic write.
 *
 * Identity is decided by id (template row ids ∪ insert nested ids); the write
 * range is decided by the YAML parser's byte range. Everything outside a
 * managed span (blank lines, comments, foreign rows) is spliced through
 * byte-for-byte (R2).
 */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { parseDocument, isMap, isSeq, isScalar, isAlias, Scalar, Document } from 'yaml'

export const CONVERGE_POLICY_VERSION = 1
export const ROLE = Object.freeze({
  'llm-pi-ai': 'merge:providers',
  subagent: 'carry',
  permission: 'carry',
  'session-log-deepseek': 'carry',
  'dsh-approval-policy': 'carry',
  'agent-default-model': 'carry',
})
export const CARRY_GROUPS = Object.freeze({
  'agent-default-model': ['provider', 'model', 'reasoningEffort'],
})
export const RETIRED_MANAGED_IDS = new Set()
export const RETIRED_INSERT_IDS = new Set()

const ABSENT = Symbol('ABSENT')
const NEVER_EQUAL = Symbol('NEVER_EQUAL')
const JS_TAG = 'tag:yaml.org,2002:js'
const jsCustomTags = [{ tag: JS_TAG, resolve: (value) => value }]
const HEAD_RE = /^[ \t]*-([ \t]+#.*)?[ \t]*$/
const PROVIDER_ID_RE = /^[a-z][a-z0-9-]*$/
const API_ENUM = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
const NO_REQUIRED_PATHS = new Set()

// P1-1: one-shot migration may only write these exact two-segment leaves.
// Anything else (unknown row, unknown leaf, extra depth) is dropped.
const EXT_ALLOWED_LEAVES = new Set([
  'subagent.maxActiveSubagents',
  'subagent.maxDepth',
  'session-log-deepseek.enabled',
  'agent-default-model.provider',
  'agent-default-model.model',
  'agent-default-model.reasoningEffort',
])
// Segment names that would escape onto Object.prototype / Function.prototype.
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

// ---------------------------------------------------------------------------
// value helpers (projection, equality, deep get/set)
// ---------------------------------------------------------------------------

// Plain-object markers (not symbols): sidecars are JSON files, so the markers
// must survive JSON.stringify. The design itself uses { $js: "..." } (06:435).
function jsValue(payload) {
  return { $js: payload }
}
function isJsValue(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).length === 1 && typeof v.$js === 'string'
}
function taggedValue(tag, value) {
  return { $tag: tag, value }
}
function isTaggedValue(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).length === 2 && typeof v.$tag === 'string' && 'value' in v
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !isJsValue(v) && !isTaggedValue(v)
}

/** YAML projection P(node) per 06 §4.2. Duplicate keys / unknown shapes => NEVER_EQUAL. */
function projectNode(node) {
  if (node === null || node === undefined) return ABSENT
  if (isAlias(node)) return projectNode(node.resolve())
  if (isMap(node)) {
    const out = {}
    for (const pair of node.items) {
      const key = pair.key === null || pair.key === undefined ? ABSENT : String(pair.key.value)
      if (key === ABSENT || Object.prototype.hasOwnProperty.call(out, key)) return NEVER_EQUAL
      out[key] = projectNode(pair.value)
    }
    return out
  }
  if (isSeq(node)) return node.items.map((item) => projectNode(item))
  if (isScalar(node)) {
    if (node.tag === JS_TAG) return jsValue(node.value)
    if (node.tag && node.tag !== 'tag:yaml.org,2002:str' && node.tag !== 'tag:yaml.org,2002:int' &&
        node.tag !== 'tag:yaml.org,2002:float' && node.tag !== 'tag:yaml.org,2002:bool' &&
        node.tag !== 'tag:yaml.org,2002:null') {
      return taggedValue(node.tag, node.value)
    }
    return node.value === undefined ? null : node.value
  }
  return NEVER_EQUAL
}

function eq(a, b) {
  if (a === NEVER_EQUAL || b === NEVER_EQUAL) return false
  return isDeepStrictEqual(a, b)
}

function getIn(obj, path) {
  let cur = obj
  for (const key of path) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, key)) return ABSENT
    cur = cur[key]
  }
  return cur
}

function setIn(obj, path, value) {
  // Defense in depth: even a future caller that bypasses prepareExternalCarry
  // cannot walk onto Object.prototype / Function.prototype via a path segment.
  for (const key of path) if (UNSAFE_PATH_SEGMENTS.has(key)) return false
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (!isPlainObject(cur[key])) cur[key] = {}
    cur = cur[key]
  }
  const last = path[path.length - 1]
  if (value === ABSENT) delete cur[last]
  else cur[last] = value
  return true
}

function cloneValue(v) {
  if (Array.isArray(v)) return v.map(cloneValue)
  if (isJsValue(v)) return jsValue(v.$js)
  if (isTaggedValue(v)) return taggedValue(v.$tag, v.value)
  if (isPlainObject(v)) {
    const out = {}
    for (const k of Object.keys(v)) out[k] = cloneValue(v[k])
    return out
  }
  return v
}

function scalarText(v) {
  if (v === ABSENT) return 'ABSENT'
  if (isJsValue(v)) return `!!js(${String(v.$js).slice(0, 80)})`
  if (Array.isArray(v)) return '[array]'
  if (isPlainObject(v)) return '{object}'
  return String(v).slice(0, 80)
}

function hashString(s) {
  return createHash('sha256').update(s).digest('hex')
}

function shapeOf(node) {
  const keys = {}
  for (const pair of node.items) {
    const key = String(pair.key.value)
    keys[key] = projectNode(pair.value)
  }
  return {
    present: true,
    id: keys.id,
    name: keys.name === undefined ? ABSENT : keys.name,
    config: keys.config === undefined ? ABSENT : keys.config,
    disabled: keys.disabled === undefined ? ABSENT : keys.disabled,
    extra: (() => {
      const out = {}
      for (const k of Object.keys(keys)) {
        if (k !== 'id' && k !== 'name' && k !== 'config' && k !== 'disabled') out[k] = keys[k]
      }
      return out
    })(),
  }
}

function disabledEq(a, b) {
  const norm = (v) => (v === ABSENT || v === null || v === undefined || v === false ? false : v)
  return eq(norm(a), norm(b))
}

function rowEq(a, b) {
  return eq(a.config, b.config) && eq(a.name, b.name) && disabledEq(a.disabled, b.disabled) && eq(a.extra, b.extra)
}

// ---------------------------------------------------------------------------
// structural analysis / splitPatch
// ---------------------------------------------------------------------------

function makeDiagnostic(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra })
}

/** Internal parse + split + R28 assertions. Returns { blocks, error }. */
function analyze(text, label = 'current') {
  if (typeof text !== 'string' || text.length === 0) {
    return { blocks: [], error: makeDiagnostic('parse', `${label}: empty or non-string input`, { line: 1, col: 1 }) }
  }
  let doc
  try {
    doc = parseDocument(text, { customTags: jsCustomTags })
  } catch (err) {
    return { blocks: [], error: makeDiagnostic('parse', `${label}: ${err.message}`, { line: 1, col: 1 }) }
  }
  if (doc.errors && doc.errors.length > 0) {
    const e = doc.errors[0]
    const pos = e.linePos && e.linePos[0]
    return {
      blocks: [],
      error: makeDiagnostic('parse', `${label}: ${e.message}`, {
        line: pos ? pos.line : 1,
        col: pos ? pos.col : 1,
      }),
    }
  }
  if (!isSeq(doc.contents)) {
    const pos = doc.contents && doc.contents.range ? doc.contents.range[0] : 0
    let line = 1
    let col = 1
    if (pos > 0) {
      const before = text.slice(0, pos)
      line = before.split('\n').length
      col = pos - before.lastIndexOf('\n')
    }
    return { blocks: [], error: makeDiagnostic('shape', `${label}: top level is not a YAML sequence`, { line, col }) }
  }

  const blocks = []
  for (const node of doc.contents.items) {
    const nodeStart = node.range ? node.range[0] : 0
    const nodeEnd = node.range ? node.range[2] : text.length
    const lineStart = text.lastIndexOf('\n', nodeStart - 1) + 1
    const head = text.slice(lineStart, nodeStart)
    if (!HEAD_RE.test(head)) {
      let line = 1
      for (let i = 0; i < nodeStart; i++) if (text[i] === '\n') line++
      const col = nodeStart - lineStart + 1
      return {
        blocks: [],
        error: makeDiagnostic('shape', `${label}: '- # comment' must share the logical line with its node (R28)`, {
          line,
          col,
          head,
        }),
      }
    }
    const indent = head.match(/^[ \t]*/)[0]
    let kind = 'foreign'
    let id
    let insertTarget
    let insertIds = []
    let key
    if (isMap(node)) {
      if (node.has('insert') && isSeq(node.get('insert', true))) {
        kind = 'insert'
        insertTarget = node.has('id') ? String(node.get('id')) : undefined
        const seq = node.get('insert', true)
        insertIds = seq.items
          .map((entry) => (isMap(entry) && entry.has('id') ? String(entry.get('id')) : undefined))
          .filter((x) => typeof x === 'string')
        key = `insert@${insertTarget ?? ''}:${[...insertIds].sort().join(',')}`
      } else if (node.has('id') && typeof node.get('id') === 'string') {
        kind = 'row'
        id = String(node.get('id'))
        key = `id:${id}`
      }
    }
    blocks.push({
      kind,
      id,
      insertTarget,
      insertIds,
      key,
      range: [lineStart, nodeEnd],
      nodeRange: [nodeStart, nodeEnd],
      head,
      indent,
      raw: text.slice(lineStart, nodeEnd),
      node,
      text,
    })
  }

  // R28 ①: spans monotonic, non-overlapping (node ranges drive replacement).
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].range[0] < blocks[i - 1].range[0] || blocks[i].range[0] < blocks[i - 1].range[1]) {
      const b = blocks[i]
      let line = 1
      for (let p = 0; p < b.range[0]; p++) if (text[p] === '\n') line++
      return {
        blocks: [],
        error: makeDiagnostic('span', `${label}: overlapping top-level spans at line ${line}`, { line, col: 1 }),
      }
    }
  }
  return { blocks, error: undefined }
}

/** Public: top-level blocks with byte ranges, id, insert info and raw text. Throws on structural error. */
export function splitPatch(text) {
  const { blocks, error } = analyze(text, 'patch')
  if (error) throw error
  return blocks
}

/** Managed identity set: top-level row ids ∪ insert nested ids (R0). */
export function managedIds(templateText) {
  const ids = new Set()
  for (const block of splitPatch(templateText)) {
    if (block.kind === 'row') ids.add(block.id)
    else if (block.kind === 'insert') for (const id of block.insertIds) ids.add(id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// sidecar projection (N9: ancestor never contains name/disabled)
// ---------------------------------------------------------------------------

function roleOf(id) {
  return ROLE[id] || 'authority'
}

function canonical(value) {
  return JSON.stringify(value, (_k, v) => {
    if (isJsValue(v)) return { $js: v.$js }
    if (isTaggedValue(v)) return { $tag: v.$tag, value: v.value }
    if (v === ABSENT) return null
    return v
  })
}

function ancestorFor(shape, role) {
  if (role === 'carry') return { config: shape.config === ABSENT ? {} : cloneValue(shape.config) }
  if (role === 'merge:providers') {
    const cfg = isPlainObject(shape.config) ? shape.config : {}
    const providers = cfg.providers === undefined ? {} : cloneValue(cfg.providers)
    const rest = {}
    for (const k of Object.keys(cfg)) if (k !== 'providers') rest[k] = cfg[k]
    return { providers, restSha256: `sha256:${hashString(canonical(rest))}` }
  }
  const authority = { config: shape.config, extra: shape.extra }
  return { ancestorSha256: `sha256:${hashString(canonical(authority))}` }
}

/** Sidecar shape for a template (used for first convergence and N1 self-heal). */
export function templateProjection(templateText, templateRevision) {
  const blocks = splitPatch(templateText)
  const rows = {}
  for (const block of blocks) {
    if (block.kind !== 'row') continue
    const shape = shapeOf(block.node)
    const role = roleOf(block.id)
    rows[block.id] = {
      role,
      disabled: shape.disabled === ABSENT || shape.disabled === false ? false : shape.disabled,
      ancestor: ancestorFor(shape, role),
    }
  }
  // Insert nested entries with a ROLE entry get a row too (e.g. dsh-approval-policy).
  for (const block of blocks) {
    if (block.kind !== 'insert') continue
    const seq = block.node.get('insert', true)
    for (const entry of seq.items) {
      if (!isMap(entry) || !entry.has('id')) continue
      const id = String(entry.get('id'))
      if (roleOf(id) === 'authority') continue
      const shape = shapeOf(entry)
      const role = roleOf(id)
      rows[id] = {
        role,
        disabled: shape.disabled === ABSENT || shape.disabled === false ? false : shape.disabled,
        ancestor: ancestorFor(shape, role),
      }
    }
  }
  const revision = templateRevision || hashString(templateText).slice(0, 16)
  return { version: 1, templateRevision: revision, rows }
}

// ---------------------------------------------------------------------------
// effective row value (R3/R17) and three-way merge primitives
// ---------------------------------------------------------------------------

function templateNameFor(templateBlocks, id) {
  const row = templateBlocks.find((b) => b.kind === 'row' && b.id === id)
  if (!row) return ABSENT
  return row.node.has('name') ? projectNode(row.node.get('name', true)) : ABSENT
}

/** E(id) per 06 §3.4.1: per-key last-wins over applicable rows, name-mismatch rows skipped. */
function effectiveRow(blocks, id, nameOfTemplate, warnSink) {
  const E = { present: false, keys: {}, applicable: [], skipped: [] }
  for (const block of blocks) {
    if (block.kind !== 'row' || block.id !== id) continue
    let applicable
    if (!block.node.has('name')) applicable = true
    else if (nameOfTemplate === ABSENT) applicable = false
    else applicable = eq(projectNode(block.node.get('name', true)), nameOfTemplate)
    if (!applicable) {
      E.skipped.push(block)
      let line = 1
      for (let p = 0; p < block.range[0]; p++) if (block.text[p] === '\n') line++
      warnSink(`row-name-mismatch: ${id}: line ${line} skipped (name does not match template)`)
      continue
    }
    E.present = true
    E.applicable.push(block)
    for (const pair of block.node.items) {
      const key = String(pair.key.value)
      E.keys[key] = projectNode(pair.value)
    }
  }
  const shape = {
    present: E.present,
    id,
    name: E.keys.name === undefined ? ABSENT : E.keys.name,
    config: E.keys.config === undefined ? ABSENT : E.keys.config,
    disabled: E.keys.disabled === undefined ? ABSENT : E.keys.disabled,
    extra: (() => {
      const out = {}
      for (const k of Object.keys(E.keys)) {
        if (k !== 'id' && k !== 'name' && k !== 'config' && k !== 'disabled') out[k] = E.keys[k]
      }
      return out
    })(),
  }
  return { ...E, shape }
}

function carryFromCurrentValue(current, next, ctx) {
  if (current === ABSENT) return next
  if (!isPlainObject(current) || !isPlainObject(next)) return cloneValue(current)
  const out = cloneValue(next)
  for (const key of Object.keys(current)) {
    const value = current[key]
    if (isJsValue(value)) {
      ctx.warns.push(`carry-js-rejected: ${ctx.id}.${ctx.path.concat(key).join('.')}: template value kept`)
      continue
    }
    out[key] = cloneValue(value)
  }
  return out
}

/** R5.1: a js-tagged leaf in the CURRENT value may never be carried. */
function rejectJsLeaves(current, expected, next, id, warns) {
  if (!isPlainObject(current) || !isPlainObject(expected)) return expected
  const nextObj = isPlainObject(next) ? next : {}
  const out = cloneValue(expected)
  for (const [key, value] of Object.entries(current)) {
    if (isJsValue(value)) {
      warns.push(`carry-js-rejected: ${id}.${key}: template value kept`)
      if (Object.prototype.hasOwnProperty.call(nextObj, key)) out[key] = cloneValue(nextObj[key])
      else delete out[key]
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = rejectJsLeaves(value, out[key], nextObj[key], `${id}.${key}`, warns)
    }
  }
  return out
}

/** merge3 per 06 §4.4.1. Arrays are atomic; recursion only into plain objects. */
function merge3Value(anc, cur, nxt, ctx) {
  if (cur === ABSENT) {
    if (anc !== ABSENT && NO_REQUIRED_PATHS.has(ctx.path.join('.'))) {
      ctx.warns.push(`required-path-restored: ${ctx.id}.${ctx.path.join('.')}`)
      return cloneValue(nxt)
    }
    return ABSENT // user deletion survives
  }
  if (anc === ABSENT) return carryFromCurrentValue(cur, nxt, ctx)
  const objectInvolved = isPlainObject(anc) || isPlainObject(cur) || isPlainObject(nxt)
  if (objectInvolved) {
    const a = isPlainObject(anc) ? anc : {}
    const c = isPlainObject(cur) ? cur : {}
    const n = isPlainObject(nxt) ? nxt : {}
    const keys = new Set([...Object.keys(a), ...Object.keys(c), ...Object.keys(n)])
    const out = {}
    for (const key of keys) {
      const res = merge3Value(
        Object.prototype.hasOwnProperty.call(a, key) ? a[key] : ABSENT,
        Object.prototype.hasOwnProperty.call(c, key) ? c[key] : ABSENT,
        Object.prototype.hasOwnProperty.call(n, key) ? n[key] : ABSENT,
        { ...ctx, path: ctx.path.concat(key) },
      )
      if (res !== ABSENT) out[key] = res
    }
    return out
  }
  if (eq(cur, anc)) return cloneValue(nxt)
  if (eq(nxt, anc)) return cloneValue(cur)
  if (eq(cur, nxt)) return cloneValue(cur)
  // both changed → current wins with path-level WARN (§4.4.2)
  ctx.warns.push(
    `carry-conflict: ${ctx.id}.${ctx.path.join('.')}: ancestor=${scalarText(anc)} current=${scalarText(cur)} next=${scalarText(nxt)}`,
  )
  return cloneValue(cur)
}

export function merge3(ancestor, current, next, opts = {}) {
  return merge3Value(ancestor, current, next, {
    id: opts.id || 'row',
    path: opts.path || [],
    warns: opts.warns || [],
  })
}

function mergeProvider(anc, cur, nxt, id, warns) {
  let m = merge3Value(anc, cur, nxt, { id, path: ['providers', id], warns })
  if (m === ABSENT) m = cloneValue(nxt)
  if (!isPlainObject(m)) m = cloneValue(nxt)
  for (const key of Object.keys(isPlainObject(nxt) ? nxt : {})) {
    if (!Object.prototype.hasOwnProperty.call(m, key)) {
      m[key] = cloneValue(nxt[key])
      warns.push(`provider-shape-restored: ${id}.${key}: template shape restored`)
    }
  }
  if (nxt.api !== undefined && m.api !== undefined && !API_ENUM.has(String(m.api))) {
    warns.push(`provider-api-invalid: ${id}: provider restored to template`)
    return cloneValue(nxt)
  }
  if (Array.isArray(nxt.models) && nxt.models.length > 0 &&
      (!Array.isArray(m.models) || m.models.length === 0) && !nxt.modelOverrides) {
    warns.push(`provider-models-invalid: ${id}: provider restored to template`)
    return cloneValue(nxt)
  }
  return m
}

/** providersMerge per 06 §5.3.1. */
export function providersMerge(anc, cur, nxt, rowId = 'llm-pi-ai', warns = []) {
  const P_anc = anc === ABSENT ? ABSENT : anc
  const P_cur = isPlainObject(cur) ? cur : {}
  const P_next = isPlainObject(nxt) ? nxt : {}
  const out = {}
  const ids = new Set([...Object.keys(P_next), ...Object.keys(P_cur)])
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(P_next, id)) {
      out[id] = cloneValue(P_cur[id])
      if (!PROVIDER_ID_RE.test(id)) warns.push(`provider-id-unstorable: ${id}: name cannot be stored as a credential record`)
      continue
    }
    const n = P_next[id]
    if (!Object.prototype.hasOwnProperty.call(P_cur, id)) {
      out[id] = cloneValue(n)
      warns.push(`provider-restored: ${id}: missing template provider restored`)
      continue
    }
    const c = P_cur[id]
    if (P_anc === ABSENT) {
      out[id] = cloneValue(n)
      warns.push(`provider-template-authority: ${id}: base unknown, template provider wins`)
      continue
    }
    const a = Object.prototype.hasOwnProperty.call(P_anc, id) ? P_anc[id] : ABSENT
    if (eq(c, a)) out[id] = cloneValue(n)
    else out[id] = mergeProvider(a, c, n, id, warns)
  }
  return out
}

function carryDisabled(cur, anc, next, templateDisabled, id, warns) {
  if (isJsValue(templateDisabled)) {
    if (typeof cur === 'boolean') warns.push(`disabled-js-overwritten: ${id}: template !!js expression restored`)
    return cloneValue(next)
  }
  const c = cur === ABSENT || cur === null ? false : cur
  const a = anc === ABSENT || anc === null ? false : anc
  const n = next === ABSENT || next === null ? false : next
  if (eq(c, a)) return n
  if (!eq(c, n) && !eq(a, n)) warns.push(`disabled-conflict: ${id}: both sides changed, current wins`)
  return c
}

// ---------------------------------------------------------------------------
// external carry validation (R21/R22/R11 — 06 §4.5/§5.4/§7.3)
// ---------------------------------------------------------------------------

function reportExtDrop(path, reason, warnings, dropped) {
  const entry = { path: String(path), reason: String(reason || 'invalid-value') }
  dropped.push(entry)
  warnings.push(`external-dropped: ${entry.path}: ${entry.reason}`)
}

/** Roles / paths one-shot migration may never write (R11, 06 §7.3). */
function extForbiddenReason(id, parts) {
  if (id === 'permission') {
    return parts[1] === 'presets' ? 'sandbox-loosening-forbidden' : 'template-authority'
  }
  if (id === 'llm-pi-ai') return 'model-table-template-owned'
  return undefined
}

/** A carry leaf must be a finite scalar of the field's expected type.
 *  P1-1: unknown rows/leaves are invalid by default; only the six whitelisted
 *  leaves can ever pass. */
function extLeafValid(id, parts, value) {
  if (isJsValue(value) || isTaggedValue(value)) return false
  if (value === undefined || value === null || typeof value === 'object') return false
  if (typeof value === 'number' && !Number.isFinite(value)) return false
  const leaf = parts.join('.')
  if (!EXT_ALLOWED_LEAVES.has(`${id}.${leaf}`)) return false
  if (id === 'session-log-deepseek' && leaf === 'enabled') return typeof value === 'boolean'
  if (id === 'subagent' && (leaf === 'maxActiveSubagents' || leaf === 'maxDepth')) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1
  }
  if (id === 'agent-default-model' && (leaf === 'provider' || leaf === 'model' || leaf === 'reasoningEffort')) {
    return typeof value === 'string'
  }
  return false
}

function templateProviders(templateIndex) {
  const block = templateIndex.rows.get('llm-pi-ai')
  if (!block) return undefined
  const cfg = shapeOf(block.node).config
  return isPlainObject(cfg) ? cfg.providers : undefined
}

/** R22: provider/model required, reasoningEffort optional but checked if present. */
function admGroupValid(values, providers) {
  if (typeof values.provider !== 'string' || typeof values.model !== 'string') {
    return { ok: false, reason: 'invalid-value' }
  }
  if (values.reasoningEffort !== undefined && typeof values.reasoningEffort !== 'string') {
    return { ok: false, reason: 'invalid-value' }
  }
  if (!isPlainObject(providers) || !Object.prototype.hasOwnProperty.call(providers, values.provider)) {
    return { ok: false, reason: 'model-id-not-in-template' }
  }
  const p = providers[values.provider]
  const models = Array.isArray(p.models) ? p.models : []
  const model = models.find((m) => isPlainObject(m) && m.id === values.model)
  let found = !!model
  if (!found && isPlainObject(p.modelOverrides)) {
    found = Object.prototype.hasOwnProperty.call(p.modelOverrides, values.model)
  }
  if (!found) return { ok: false, reason: 'model-id-not-in-template' }
  if (values.reasoningEffort !== undefined && model && isPlainObject(model.reasoningEfforts) &&
      !Object.prototype.hasOwnProperty.call(model.reasoningEfforts, values.reasoningEffort)) {
    return { ok: false, reason: 'invalid-value' }
  }
  return { ok: true }
}

/**
 * Validate the one-shot migration input once per converge call. Returns a
 * sanitized ext whose `values` hold only applicable leaf paths; every
 * rejection is appended to `dropped` and `warnings` as `<rowId>.<dot.path>`.
 */
function prepareExternalCarry(externalCarry, templateIndex, warnings, dropped) {
  if (!externalCarry || typeof externalCarry !== 'object') return undefined
  if (Array.isArray(externalCarry.dropped)) {
    for (const d of externalCarry.dropped) reportExtDrop(d && d.path, d && d.reason, warnings, dropped)
  }
  if (!isPlainObject(externalCarry.values)) return undefined
  const providers = templateProviders(templateIndex)
  const valid = {}
  const adm = {}
  const admPaths = {}
  for (const [path, value] of Object.entries(externalCarry.values)) {
    const parts = String(path).split('.')
    const id = parts[0]
    // P1-1: unsafe segment names are rejected with invalid-value, ahead of any
    // role-specific reason, so a polluting path never gets a different verdict.
    if (parts.some((seg) => UNSAFE_PATH_SEGMENTS.has(seg))) {
      reportExtDrop(path, 'invalid-value', warnings, dropped); continue
    }
    const forbidden = extForbiddenReason(id, parts)
    if (forbidden) { reportExtDrop(path, forbidden, warnings, dropped); continue }
    // P1-1: exact two-segment whitelist only. Unknown rows, unknown leaves and
    // extra depth are dropped instead of being treated as legal by default.
    if (parts.length !== 2 || !EXT_ALLOWED_LEAVES.has(path) ||
        !templateIndex.rows.has(id) || roleOf(id) !== 'carry') {
      reportExtDrop(path, 'invalid-value', warnings, dropped); continue
    }
    if (!extLeafValid(id, parts.slice(1), value)) {
      reportExtDrop(path, 'invalid-value', warnings, dropped); continue
    }
    if (id === 'agent-default-model') {
      adm[parts[1]] = value
      admPaths[parts[1]] = path
      continue
    }
    valid[path] = value
  }
  if (Object.keys(adm).length > 0) {
    const verdict = admGroupValid(adm, providers)
    if (verdict.ok) {
      for (const [key, path] of Object.entries(admPaths)) valid[path] = adm[key]
    } else {
      for (const path of Object.values(admPaths)) reportExtDrop(path, verdict.reason, warnings, dropped)
    }
  }
  return { source: externalCarry.source, values: valid }
}

/** Apply the sanitized ext to one carry row (leaf setIn); ancestor untouched. */
function applyExt(shape, ext, id) {
  if (!ext || !isPlainObject(ext.values)) return shape
  const out = cloneValue(shape)
  for (const [path, value] of Object.entries(ext.values)) {
    const parts = path.split('.')
    if (parts[0] !== id || parts.length < 2) continue
    if (out.config === ABSENT) out.config = {}
    if (!isPlainObject(out.config)) continue
    setIn(out.config, parts.slice(1), cloneValue(value))
  }
  return out
}

/** R22: verify agent-default-model triple against the (merged) provider table. */
function checkCarryGroup(id, config, nextConfig) {
  if (!CARRY_GROUPS[id]) return true
  const group = CARRY_GROUPS[id]
  if (!isPlainObject(config)) return false
  for (const key of group) {
    if (key !== 'reasoningEffort' && (config[key] === undefined || config[key] === ABSENT)) return false
  }
  // Cross-row validation against providers is performed by the caller (needs llm-pi-ai).
  return true
}

// ---------------------------------------------------------------------------
// rendering (clone template AST; no whole-file round trip)
// ---------------------------------------------------------------------------

function valueToNode(value, doc) {
  if (isJsValue(value)) {
    const scalar = new Scalar(value.$js)
    scalar.tag = JS_TAG
    return scalar
  }
  if (isTaggedValue(value)) {
    const scalar = new Scalar(value.value)
    scalar.tag = value.$tag
    return scalar
  }
  if (Array.isArray(value)) {
    const seq = doc.createNode([])
    for (const item of value) seq.add(valueToNode(item, doc))
    return seq
  }
  if (isPlainObject(value)) {
    const map = doc.createNode({})
    for (const key of Object.keys(value)) map.set(key, valueToNode(value[key], doc))
    return map
  }
  return new Scalar(value === ABSENT ? null : value)
}

function normalizeEol(text, eol) {
  if (eol === '\n') return text.replace(/\r\n/g, '\n')
  return text.replace(/\r\n/g, '\n').replace(/\n/g, eol)
}

function dominantEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length
  const lf = (text.match(/(?<!\r)\n/g) || []).length
  return crlf > lf ? '\r\n' : '\n'
}

function eolOfBlock(block) {
  return block.raw.includes('\r\n') ? '\r\n' : '\n'
}

function renderRow(templateBlock, expected, eol) {
  const tplShape = shapeOf(templateBlock.node)
  if (rowEq(expected, tplShape)) return normalizeEol(templateBlock.raw, eol)
  const doc = new Document()
  const node = templateBlock.node.clone()
  // config (template leaves with !!js markers survive via valueToNode)
  if (isPlainObject(expected.config) || Array.isArray(expected.config) || isJsValue(expected.config)) {
    node.set('config', valueToNode(expected.config, doc))
  } else if (node.has('config')) node.delete('config')
  // name: template name is authoritative (R24); template clone already has it.
  // disabled (R20): true/!!js -> write; false/absent -> omit.
  const d = expected.disabled
  if (d === true || isJsValue(d) || isTaggedValue(d)) node.set('disabled', valueToNode(d, doc))
  else if (node.has('disabled')) node.delete('disabled')
  // extra: template clone already carries template extras (authority).
  doc.contents = doc.createNode([node])
  const rendered = String(doc, { lineWidth: 0 })
  return normalizeEol(rendered, eol)
}

function renderInsertBlock(templateBlock, currentBlock, entries, eol) {
  const doc = new Document()
  const entryNodes = entries.map((entry) => valueToNode(entry, doc))
  const seq = doc.createNode([])
  for (const node of entryNodes) seq.add(node)
  const map = doc.createNode({ insert: null })
  map.set('insert', seq)
  doc.contents = doc.createNode([map])
  void templateBlock
  void currentBlock
  return normalizeEol(String(doc, { lineWidth: 0 }), eol)
}

function entryShape(entry) {
  if (!isMap(entry) || !entry.has('id')) return undefined
  return shapeOf(entry)
}

// ---------------------------------------------------------------------------
// preamble repair (R13)
// ---------------------------------------------------------------------------

function preambleEdit(current, template, revision, blocks) {
  const firstStart = blocks.length > 0 ? blocks[0].range[0] : current.length
  const head = current.slice(0, firstStart)
  const tplBlocks = splitPatch(template)
  const tplHead = template.slice(0, tplBlocks.length > 0 ? tplBlocks[0].range[0] : template.length)
  const expectedHead = tplHead.replace(/(# profileRevision: )[^\n]*/, `$1${revision}`)
  const eol = head.includes('\r\n') ? '\r\n' : '\n'
  const norm = (s) => s.replace(/\r\n/g, '\n')
  if (norm(head) === expectedHead) return undefined

  let newHead = norm(head)
  const headerLine = '# dsh-opentui inproc profile patch'
  if (!newHead.startsWith(headerLine)) {
    const header = expectedHead.slice(0, expectedHead.indexOf('\n') + 1)
    newHead = header + newHead
  }
  if (/# profileRevision: /.test(newHead)) {
    newHead = newHead.replace(/(# profileRevision: )[^\n]*/, `$1${revision}`)
  } else {
    const revLine = expectedHead.split('\n').find((line) => line.startsWith('# profileRevision: '))
    const firstNl = newHead.indexOf('\n')
    newHead = newHead.slice(0, firstNl + 1) + `${revLine}\n` + newHead.slice(firstNl + 1)
  }
  // R13: one blank line between the first comment block and the first item.
  if (newHead.length > 0 && !/\n[ \t]*\n$/.test(newHead)) newHead += '\n'
  if (newHead === norm(head)) return undefined
  return { start: 0, end: firstStart, text: normalizeEol(newHead, eol), reason: 'preamble' }
}

// ---------------------------------------------------------------------------
// backup reason priority + path reporting (R10/R29)
// ---------------------------------------------------------------------------

const BACKUP_PRIORITY = ['duplicates', 'foreign-comments', 'drift', 'new-managed-row', 'base-unknown']

function pickBackup(reasons) {
  for (const reason of BACKUP_PRIORITY) if (reasons.has(reason)) return reason
  return undefined
}

function collectForeignComments(block, templateBlock, notes) {
  if (!block || !templateBlock) return false
  const commentRe = /#[^\n]*/g
  const currentComments = block.raw.match(commentRe) || []
  const tplComments = templateBlock.raw.match(commentRe) || []
  const foreign = currentComments.filter((c) => !tplComments.includes(c))
  if (foreign.length === 0) return false
  notes.push(`foreign-comments: ${block.id || 'insert'}: ${foreign.join(' | ').slice(0, 200)}`)
  return true
}

function pathLines(id, path, cur, next, paths, notes, label) {
  if (eq(cur, next)) return
  const line = `${id}.${path}: ${scalarText(cur)} → ${scalarText(next)}`
  paths.push(line)
  notes.push(`${label}: ${line}`)
}

// ---------------------------------------------------------------------------
// converge
// ---------------------------------------------------------------------------

function indexTemplate(template) {
  const analysis = analyze(template, 'template')
  if (analysis.error) throw analysis.error // template parse failure is a build bug
  const blocks = analysis.blocks
  const rows = new Map()
  const inserts = []
  for (const block of blocks) {
    if (block.kind === 'row') rows.set(block.id, block)
    else if (block.kind === 'insert') inserts.push(block)
  }
  return { blocks, rows, inserts }
}

function applyEdits(base, list) {
  let result = base
  const sorted = [...list].sort((a, b) => b.start - a.start || b.end - a.end)
  for (const edit of sorted) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  return result
}

function absentConverge({ template, templateIndex, revision, externalCarry, notes, warnings, dropped }) {
  const edits = []
  for (const [id, tplBlock] of templateIndex.rows) {
    const shape = shapeOf(tplBlock.node)
    const nextEff = applyExt(shape, externalCarry, id)
    if (rowEq(nextEff, shape)) continue
    const expected = {
      id,
      name: shape.name,
      config: nextEff.config,
      disabled: nextEff.disabled,
      extra: shape.extra,
    }
    edits.push({ start: tplBlock.range[0], end: tplBlock.range[1], text: renderRow(tplBlock, expected, '\n') })
  }
  const content = edits.length > 0 ? applyEdits(template, edits) : template
  return {
    write: true,
    content,
    reason: 'absent',
    backupReason: undefined,
    backupPaths: [],
    paths: [],
    carried: [],
    drift: [],
    notes,
    warnings,
    dropped,
    sidecar: templateProjection(template, revision),
  }
}

/**
 * Main entry (06 §4.6.1). Returns a plain result; never writes, never throws
 * for bad `current` (returns `{ write:false, error }` instead).
 */
export function converge({ template, current, sidecar, templateRevision, externalCarry }) {
  const notes = []
  const warnings = []
  const paths = []
  const backupReasons = new Set()
  const revision = templateRevision || hashString(template).slice(0, 16)

  const templateIndex = indexTemplate(template)
  const managed = managedIds(template)
  const dropped = []
  const ext = prepareExternalCarry(externalCarry, templateIndex, warnings, dropped)

  if (current === undefined || current === null || current === '') {
    return absentConverge({ template, templateIndex, revision, sidecar, externalCarry: ext, notes, warnings, dropped })
  }

  const analysis = analyze(current, 'current')
  if (analysis.error) {
    return {
      write: false,
      error: {
        code: analysis.error.code,
        message: analysis.error.message,
        line: analysis.error.line,
        col: analysis.error.col,
      },
      notes,
      warnings,
      dropped,
      backupPaths: [],
      paths,
    }
  }
  const blocks = analysis.blocks
  const fileEol = dominantEol(current)

  // A sidecar is a valid merge ancestor iff version === 1 and rows is a map
  // (06 §4.3.1). A stale `templateRevision` does NOT invalidate the rows: that
  // is exactly how a template default change is detected (§4.3.2). Stale
  // revision matters only for N1's no-write sidecar self-heal path.
  const stateUsable = !!sidecar && sidecar.version === 1 && isPlainObject(sidecar.rows)
  const stateRows = stateUsable ? sidecar.rows : undefined
  const sidecarStale = stateUsable && sidecar.templateRevision !== revision

  const edits = []
  const missingRows = []
  const duplicates = []
  const retired = []
  const missingInserts = []
  const rewriteInserts = []
  const expectedShapes = new Map()

  // ---- managed rows -------------------------------------------------------
  for (const [id, templateBlock] of templateIndex.rows) {
    const tplShape = shapeOf(templateBlock.node)
    const nameOfTemplate = tplShape.name
    const E = effectiveRow(blocks, id, nameOfTemplate, warnings)
    if (!E.present) missingRows.push(id)
    if (E.applicable.length > 1) {
      duplicates.push(id)
      backupReasons.add('duplicates')
      pathLines(id, 'rows', `${E.applicable.length} applicable rows`, '1', paths, notes, 'duplicates')
    }
    const role = roleOf(id)
    const curShape = E.shape
    const nextShape = tplShape
    const nextEff = applyExt(nextShape, ext, id)
    const ancRow = stateRows ? stateRows[id] : undefined
    let expectedConfig

    if (!E.present || curShape.config === ABSENT) {
      // R23-②/③: line absent or config absent (host reset) -> template + ext, no backup.
      expectedConfig = cloneValue(nextEff.config)
      if (E.present && Object.keys(curShape.extra).length > 0) {
        warnings.push(`row-extra-key: ${id}: ${Object.keys(curShape.extra).join(',')}`)
      }
    } else if (!stateUsable) {
      // base-unknown (R4.3.3): carry current, default not updated.
      if (role === 'merge:providers') {
        const pCur = isPlainObject(curShape.config) ? curShape.config.providers : ABSENT
        const pNext = isPlainObject(nextEff.config) ? nextEff.config.providers : ABSENT
        expectedConfig = isPlainObject(curShape.config)
          ? { ...cloneValue(nextEff.config), providers: providersMerge(ABSENT, pCur, pNext, id, warnings) }
          : cloneValue(nextEff.config)
        backupReasons.add('base-unknown')
      } else if (role === 'carry') {
        expectedConfig = carryFromCurrentValue(curShape.config, nextEff.config, { id, path: [], warns: warnings })
        backupReasons.add('base-unknown')
      } else {
        expectedConfig = cloneValue(nextEff.config)
        if (!eq(curShape.config, nextEff.config)) backupReasons.add('base-unknown')
      }
      pathLines(id, 'config', curShape.config, expectedConfig, paths, notes, 'base-unknown')
    } else if (ancRow === undefined) {
      // new managed row (state exists but row absent)
      if (role === 'merge:providers') {
        const pCur = isPlainObject(curShape.config) ? curShape.config.providers : ABSENT
        const pNext = isPlainObject(nextEff.config) ? nextEff.config.providers : ABSENT
        expectedConfig = isPlainObject(curShape.config)
          ? { ...cloneValue(nextEff.config), providers: providersMerge(ABSENT, pCur, pNext, id, warnings) }
          : cloneValue(nextEff.config)
      } else {
        expectedConfig = cloneValue(nextEff.config)
      }
      backupReasons.add('new-managed-row')
      pathLines(id, 'config', curShape.config, expectedConfig, paths, notes, 'new-managed-row')
    } else {
      const anc = ancRow.ancestor || {}
      if (role === 'carry') {
        const ancConfig = anc.config === undefined ? ABSENT : anc.config
        if (eq(curShape.config, ancConfig)) {
          expectedConfig = cloneValue(nextEff.config)
        } else {
          expectedConfig = merge3Value(ancConfig, curShape.config, nextEff.config, {
            id,
            path: [],
            warns: warnings,
          })
          if (expectedConfig === ABSENT) expectedConfig = cloneValue(nextEff.config)
          expectedConfig = rejectJsLeaves(curShape.config, expectedConfig, nextEff.config, id, warnings)
          // R22 group atomicity (cross-row validation done below)
        }
      } else if (role === 'merge:providers') {
        const pAnc = anc.providers === undefined ? ABSENT : anc.providers
        const pCur = isPlainObject(curShape.config) ? curShape.config.providers : ABSENT
        const pNext = isPlainObject(nextEff.config) ? nextEff.config.providers : ABSENT
        expectedConfig = isPlainObject(curShape.config)
          ? { ...cloneValue(nextEff.config), providers: providersMerge(pAnc, pCur, pNext, id, warnings) }
          : cloneValue(nextEff.config)
        // restConfig is template authority; a user change there is drift.
        const restCur = {}
        const restNext = {}
        if (isPlainObject(curShape.config)) for (const k of Object.keys(curShape.config)) if (k !== 'providers') restCur[k] = curShape.config[k]
        if (isPlainObject(nextEff.config)) for (const k of Object.keys(nextEff.config)) if (k !== 'providers') restNext[k] = nextEff.config[k]
        if (!eq(restCur, restNext)) {
          backupReasons.add('drift')
          pathLines(id, 'restConfig', restCur, restNext, paths, notes, 'drift')
        }
      } else {
        expectedConfig = cloneValue(nextEff.config)
        const curAuthority = canonical({ config: curShape.config, extra: curShape.extra })
        const expectedSha = `sha256:${hashString(curAuthority)}`
        if (anc.ancestorSha256 !== expectedSha) {
          backupReasons.add('drift')
          pathLines(id, 'config', curShape.config, expectedConfig, paths, notes, 'drift')
        }
      }
      pathLines(id, 'config', curShape.config, expectedConfig, paths, notes, 'compare')
      void ancRow
    }

    // R22: group rejected -> whole group back to template.
    if (CARRY_GROUPS[id] && !checkCarryGroup(id, expectedConfig, nextEff.config)) {
      warnings.push(`carry-group-rejected: ${id}: group failed validation, template restored`)
      expectedConfig = cloneValue(nextEff.config)
    }

    // R20: disabled carry, orthogonal to role.
    const templateDisabled = tplShape.disabled
    const ancDisabled = ancRow ? ancRow.disabled : ABSENT
    const expectedDisabled = carryDisabled(
      curShape.disabled,
      ancDisabled === undefined ? ABSENT : ancDisabled,
      nextEff.disabled,
      templateDisabled,
      id,
      warnings,
    )

    const expected = {
      id,
      name: tplShape.name, // R24: template name always wins
      config: expectedConfig,
      disabled: expectedDisabled,
      extra: tplShape.extra,
    }
    expectedShapes.set(id, expected)

    if (!rowEq(expected, curShape) || !E.present || E.applicable.length > 1) {
      const eol = E.applicable.length > 0 ? eolOfBlock(E.applicable[0]) : fileEol
      if (collectForeignComments(E.applicable[0], templateBlock, notes)) backupReasons.add('foreign-comments')
      const rendered = renderRow(templateBlock, expected, eol)
      if (E.applicable.length > 0) {
        edits.push({ start: E.applicable[0].range[0], end: E.applicable[0].range[1], text: rendered })
        for (let i = 1; i < E.applicable.length; i++) {
          edits.push({ start: E.applicable[i].range[0], end: E.applicable[i].range[1], text: '' })
        }
      }
    }
  }

  // R22 cross-row validation: agent-default-model provider/model must exist in merged llm-pi-ai providers.
  const admExpected = expectedShapes.get('agent-default-model')
  if (admExpected && isPlainObject(admExpected.config)) {
    const provider = admExpected.config.provider
    const llm = expectedShapes.get('llm-pi-ai')
    if (provider !== undefined && llm && isPlainObject(llm.config) && isPlainObject(llm.config.providers)) {
      const p = llm.config.providers[provider]
      let ok = !!p
      const model = admExpected.config.model
      if (ok && model !== undefined && Array.isArray(p.models)) {
        ok = p.models.some((m) => isPlainObject(m) && m.id === model)
        if (!ok && isPlainObject(p.modelOverrides)) ok = Object.prototype.hasOwnProperty.call(p.modelOverrides, model)
      }
      if (!ok) {
        warnings.push('carry-group-rejected: agent-default-model: provider/model not in merged provider table, template restored')
        const tplBlock = templateIndex.rows.get('agent-default-model')
        if (tplBlock) {
          admExpected.config = cloneValue(shapeOf(tplBlock.node).config)
          const eol = fileEol
          const rendered = renderRow(tplBlock, admExpected, eol)
          const E = effectiveRow(blocks, 'agent-default-model', shapeOf(tplBlock.node).name, () => {})
          if (E.applicable.length > 0) {
            // replace an earlier edit for the same anchor
            const idx = edits.findIndex((ed) => ed.start === E.applicable[0].range[0])
            if (idx >= 0) edits.splice(idx, 1, { start: E.applicable[0].range[0], end: E.applicable[0].range[1], text: rendered })
          }
        }
      }
    }
  }

  // ---- retired ids --------------------------------------------------------
  for (const block of blocks) {
    if (block.kind === 'row' && RETIRED_MANAGED_IDS.has(block.id)) {
      retired.push(block.id)
      edits.push({ start: block.range[0], end: block.range[1], text: '' })
      notes.push(`retired: ${block.id}: removed`)
    }
  }

  // ---- managed insert blocks (R18) ---------------------------------------
  for (const tplInsert of templateIndex.inserts) {
    const tplIds = new Set(tplInsert.insertIds)
    const candidates = blocks.filter(
      (b) => b.kind === 'insert' && b.insertIds.some((id) => tplIds.has(id) || RETIRED_INSERT_IDS.has(id)),
    )
    if (candidates.length === 0) {
      missingInserts.push(tplInsert.key)
      continue
    }
    if (candidates.length > 1) {
      duplicates.push(tplInsert.key)
      backupReasons.add('duplicates')
      pathLines(tplInsert.key, 'blocks', `${candidates.length} insert blocks`, '1', paths, notes, 'duplicates')
    }
    const cur = candidates[0]
    const tplSeq = tplInsert.node.get('insert', true)
    const curSeq = cur.node.get('insert', true)
    const tplEntries = tplSeq.items.filter(isMap)
    const curEntries = curSeq.items.filter(isMap)
    const tplEntryById = new Map(tplEntries.map((e) => [String(e.get('id')), e]))
    const curEntryById = new Map(curEntries.map((e) => [String(e.get('id')), e]))

    let needsRewrite = false
    const outEntries = []
    // Conflicts: nested id that is a top-level managed row id must be dropped.
    for (const [id, entry] of curEntryById) {
      if (managed.has(id) && !tplEntryById.has(id)) {
        warnings.push(`insert-managed-id-removed: ${id}: nested managed row removed from insert block`)
        needsRewrite = true
      }
    }
    for (const [id, tplEntry] of tplEntryById) {
      const tplShape = entryShape(tplEntry)
      const curEntry = curEntryById.get(id)
      let entryValue = {
        id,
        name: tplShape.name === ABSENT ? undefined : tplShape.name,
        config: tplShape.config === ABSENT ? undefined : cloneValue(tplShape.config),
      }
      // Insert nested entries with a ROLE get carry treatment (e.g. dsh-approval-policy).
      if (roleOf(id) !== 'authority' && curEntry && stateUsable) {
        const role = roleOf(id)
        const anc = stateRows && stateRows[id] ? stateRows[id].ancestor : undefined
        const curCfg = curEntry.has('config') ? projectNode(curEntry.get('config', true)) : ABSENT
        if (!anc || !isPlainObject(entryValue.config)) {
          needsRewrite = needsRewrite || !eq(curCfg, entryValue.config)
        } else if (role === 'carry') {
          const merged = eq(curCfg, anc.config) ? cloneValue(entryValue.config)
            : merge3Value(anc.config, curCfg, entryValue.config, { id, path: [], warns: warnings })
          entryValue.config = merged === ABSENT ? cloneValue(entryValue.config) : merged
          needsRewrite = needsRewrite || !eq(curCfg, entryValue.config)
        } else {
          needsRewrite = needsRewrite || !eq(curCfg, entryValue.config)
        }
      } else {
        needsRewrite = needsRewrite || !curEntry || !eq(projectNode(tplEntry), projectNode(curEntry))
      }
      outEntries.push(entryValue)
    }
    // User-added entries preserved and appended after template entries (R18/P0-4).
    let userEntryMoved = false
    for (const [id, entry] of curEntryById) {
      if (tplEntryById.has(id)) continue
      if (managed.has(id)) continue
      const shape = entryShape(entry)
      outEntries.push({ id, name: shape.name === ABSENT ? undefined : shape.name, config: shape.config === ABSENT ? undefined : cloneValue(shape.config) })
      userEntryMoved = true
    }
    if (userEntryMoved && needsRewrite) {
      warnings.push(`insert-user-entry-moved: ${tplInsert.key}: user entries re-appended after template entries`)
    }
    const nestedConflict = [...curEntryById.keys()].some((id) => managed.has(id) && !tplEntryById.has(id))
    if (nestedConflict) needsRewrite = true
    // Duplicate insert blocks: drop the rest.
    for (let i = 1; i < candidates.length; i++) {
      edits.push({ start: candidates[i].range[0], end: candidates[i].range[1], text: '' })
    }
    if (needsRewrite) {
      rewriteInserts.push(tplInsert.key)
      if (collectForeignComments(cur, tplInsert, notes)) backupReasons.add('foreign-comments')
      const rendered = renderInsertBlock(tplInsert, cur, outEntries, eolOfBlock(cur))
      edits.push({ start: cur.range[0], end: cur.range[1], text: rendered })
    }
  }

  // ---- missing rows / inserts appended to EOF (R23/R27) -------------------
  const appended = []
  for (const id of missingRows) {
    const tplBlock = templateIndex.rows.get(id)
    const expected = expectedShapes.get(id)
    if (!tplBlock || !expected) continue
    const eol = fileEol
    appended.push(renderRow(tplBlock, expected, eol))
  }
  for (const key of missingInserts) {
    const tplInsert = templateIndex.inserts.find((b) => b.key === key)
    if (!tplInsert) continue
    const entries = tplInsert.node.get('insert', true).items.filter(isMap).map((e) => {
      const shape = entryShape(e)
      return {
        id: shape.id,
        name: shape.name === ABSENT ? undefined : shape.name,
        config: shape.config === ABSENT ? undefined : cloneValue(shape.config),
      }
    })
    appended.push(renderInsertBlock(tplInsert, undefined, entries, fileEol))
  }

  // ---- preamble (R13) -----------------------------------------------------
  const preamble = preambleEdit(current, template, revision, blocks)
  if (preamble) edits.push(preamble)

  const semanticDiff = [...expectedShapes.entries()].some(([id, expected]) => {
    const E = effectiveRow(blocks, id, shapeOf(templateIndex.rows.get(id).node).name, () => {})
    return !rowEq(expected, E.shape)
  })
  const write =
    missingRows.length > 0 ||
    missingInserts.length > 0 ||
    duplicates.length > 0 ||
    retired.length > 0 ||
    rewriteInserts.length > 0 ||
    semanticDiff ||
    !!preamble

  // ---- assemble content ---------------------------------------------------
  let content = current
  if (write) {
    content = applyEdits(current, edits)
    if (appended.length > 0) {
      const sep = content.endsWith('\n') ? '' : fileEol
      content += sep + appended.join('')
    }
  }

  // ---- result -------------------------------------------------------------
  const backupReason = pickBackup(backupReasons)
  const notesOut = [...notes]
  if (backupReason) notesOut.unshift(`backup: ${backupReason}`)

  const result = {
    write,
    content,
    reason: write ? (missingRows.length || missingInserts.length ? 'missing'
      : duplicates.length ? 'duplicates'
      : retired.length ? 'retired'
      : rewriteInserts.length ? 'managed-diff'
      : preamble ? 'preamble' : 'managed-diff') : 'semantically-equal',
    backupReason,
    backupPaths: paths,
    paths,
    carried: [],
    drift: notes.filter((n) => n.startsWith('drift:')),
    droppedComments: notes.filter((n) => n.startsWith('foreign-comments:')),
    notes: notesOut,
    warnings,
    dropped,
    missingRows,
    missingInserts,
    duplicates,
    retired,
    rewriteInserts,
  }

  if (write) {
    result.sidecar = templateProjection(template, revision)
  } else if (!stateUsable || sidecarStale) {
    // N1: self-heal the sidecar even when the patch needs no write.
    result.writeSidecarOnly = true
    result.sidecar = templateProjection(template, revision)
    warnings.push('sidecar-self-heal: patch is already converged but sidecar is missing/corrupt/stale; writing sidecar only')
  } else {
    result.sidecar = undefined
  }
  return result
}

export default {
  splitPatch,
  managedIds,
  templateProjection,
  converge,
  merge3,
  providersMerge,
  ROLE,
  CARRY_GROUPS,
  CONVERGE_POLICY_VERSION,
}
