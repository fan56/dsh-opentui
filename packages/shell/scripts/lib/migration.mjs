/**
 * T8 — one-shot migration planner (pure function; no fs / no clock / no env).
 *
 * Given the text of the two legacy profiles plus the current new template,
 * produce everything T8b needs to write: the `externalCarry` payload consumed
 * by `converge` (T8a1), the config/keybindings payloads, the backup manifest,
 * the marker (minus at/version/digest, which the caller fills), and a set of
 * user-visible notices.
 *
 * Design refs: 06 §4.5, §4.6.1, §7.1–7.5; D6; D8-Q2; handoff §二.
 *
 * Hard rules encoded here:
 *  - source priority is per-leaf (opentui-inproc first), never "fall back
 *    because the inproc value happens to equal the template" (06 §7.3);
 *  - only values that deviate from the *source-side* template default become
 *    ext entries (06 R21 / §4.5.1);
 *  - forbidden families (permission / providers / inserts / old rows) and the
 *    four removed model ids are reported as `dropped`, never carried;
 *  - a legacy patch that fails to parse is never silently treated as empty:
 *    it is backed up, reported as `invalid-value`, and `canWriteMarker` is
 *    false so T8b retries on the next start;
 *  - template parse failure is a build-time bug and throws (06 §4.6.1);
 *  - `provider-keys.json` is backed up only, never treated as live credentials
 *    (D8-Q2: keys live in ~/.dsh/.credentials.yaml, re-login required).
 */
import { parseDocument, isMap, isSeq, isScalar, isAlias } from 'yaml'

const JS_TAG = 'tag:yaml.org,2002:js'
const jsCustomTags = [{ tag: JS_TAG, resolve: (value) => value }]

/** Known client preference keys (everything else is still kept, only warned). */
const KNOWN_CONFIG_KEYS = new Set([
  'retentionDays', 'theme', 'skinMigration', 'slashUsage', 'footerHints', 'lang', 'session',
])

/** The four model ids removed from the new template (D2 / 06 §7.2). */
const OLD_MODEL_IDS = [
  'glm-5.4',
  'mimo-v2.6-pro-ultraspeed',
  'hy4-flash-free',
  'qwen4-max',
]

/** 06 §4.5: defaults of source A (`opentui`) used for deviation detection. */
const OPENTUI_DEFAULTS = {
  'subagent.maxActiveSubagents': 3,
  'session-log-deepseek.enabled': true,
  'agent-default-model.provider': 'opencode-go',
  'agent-default-model.model': 'deepseek-v4.1-flash',
  'agent-default-model.reasoningEffort': 'high',
}

/** Insert ids that already exist in the template → duplicate if migrated. */
const DUPLICATE_INSERT_IDS = new Set(['tool-ask-user', 'mcp-context7', 'dsh-opentui-approval-gate'])
const APPEND_PRESET_ID = 'preset-opentui-append-system'
/** Old HTTP-only rows with no bundle in the inproc profile. */
const DEAD_ROW_IDS = new Set(['web', 'ui-settings-general'])
/** Tool/agent rows the template regenerates verbatim (06 §7.2/§7.3). */
const TEMPLATE_OWNED_ROW_IDS = new Set([
  'tool-bash', 'tool-todo', 'tool-fs', 'tool-fs-search',
  'agent-instructions', 'tool-result-pruner', 'tool-web',
])
/** Only these leaves of a carry row are migration candidates; anything else
 *  is a user value we cannot carry and must be reported (06 §7.5). */
const CARRY_LEAF_KEYS = {
  subagent: new Set(['maxActiveSubagents', 'maxDepth']),
  'session-log-deepseek': new Set(['enabled']),
  'agent-default-model': new Set(['provider', 'model', 'reasoningEffort']),
}

/** The one nested insert config leaf that is a migration candidate. Its ext
 *  path carries the literal `config` segment so converge writes it to the
 *  matching insert entry rather than to a top-level row. */
const APPROVAL_POLICY_ID = 'dsh-approval-policy'
const WINDOW_SECONDS_PATH = `${APPROVAL_POLICY_ID}.config.windowSeconds`

// ---------------------------------------------------------------------------
// value helpers (mirror patch-ownership projection, no fs/clock)
// ---------------------------------------------------------------------------

function jsValue(payload) {
  return { $js: payload }
}
function isJsValue(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).length === 1 && typeof v.$js === 'string'
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !isJsValue(v)
}
function hasOwn(obj, key) {
  return isPlainObject(obj) && Object.prototype.hasOwnProperty.call(obj, key)
}

/** Project a YAML node to a comparable plain value; `!!js` -> {$js:...}. */
function projectNode(node) {
  if (node === null || node === undefined) return undefined
  if (isAlias(node)) return projectNode(node.resolve())
  if (isMap(node)) {
    const out = {}
    for (const pair of node.items) {
      const key = pair.key === null || pair.key === undefined ? undefined : String(pair.key.value)
      if (key === undefined || hasOwn(out, key)) continue
      out[key] = projectNode(pair.value)
    }
    return out
  }
  if (isSeq(node)) return node.items.map((item) => projectNode(item))
  if (isScalar(node)) {
    if (node.tag === JS_TAG) return jsValue(node.value)
    return node.value === undefined ? null : node.value
  }
  return undefined
}

function scalarOf(node) {
  return isScalar(node) ? node.value : undefined
}

function cloneValue(v) {
  if (Array.isArray(v)) return v.map(cloneValue)
  if (isJsValue(v)) return jsValue(v.$js)
  if (isPlainObject(v)) {
    const out = {}
    for (const k of Object.keys(v)) out[k] = cloneValue(v[k])
    return out
  }
  return v
}

function getIn(obj, parts) {
  let cur = obj
  for (const key of parts) {
    if (!hasOwn(cur, key)) return undefined
    cur = cur[key]
  }
  return cur
}

function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

// ---------------------------------------------------------------------------
// patch parsing (P1-1 / P1-3)
// ---------------------------------------------------------------------------

function emptyIndex() {
  // insertRows holds the projected config of nested insert entries (keyed by
  // entry id), so migration can read leaves such as the approval window that
  // are not top-level rows.
  return { rows: new Map(), inserts: [], insertRows: new Map() }
}

/**
 * Parse a patch into `{ index, parseError }`.
 *
 * `yaml.parseDocument` does NOT throw on most syntax errors — `doc.errors`
 * holds them. A non-empty legacy patch that fails to parse, or whose top level
 * is not a sequence, yields an empty index WITH `parseError: true`, so the
 * caller can refuse to write a marker (06 §7.4 "迁移写失败 → 不写 marker").
 */
function indexPatch(text) {
  const index = emptyIndex()
  if (typeof text !== 'string' || text.length === 0) return { index, parseError: false }
  let doc
  try {
    doc = parseDocument(text, { customTags: jsCustomTags })
  } catch {
    return { index, parseError: true }
  }
  if (!doc || doc.errors.length > 0 || !isSeq(doc.contents)) {
    return { index, parseError: true }
  }
  for (const item of doc.contents.items) {
    if (!isMap(item)) continue
    const insertNode = item.get('insert', true)
    if (isSeq(insertNode)) {
      const ids = []
      for (const entry of insertNode.items) {
        if (isMap(entry)) {
          const id = scalarOf(entry.get('id', true))
          if (id !== undefined && id !== null) {
            const key = String(id)
            ids.push(key)
            index.insertRows.set(key, projectNode(entry.get('config', true)))
          }
        }
      }
      const target = scalarOf(item.get('id', true))
      index.inserts.push({ target: target == null ? undefined : String(target), ids })
      continue
    }
    const id = scalarOf(item.get('id', true))
    if (id === undefined || id === null) continue
    const cfgNode = item.get('config', true)
    index.rows.set(String(id), projectNode(cfgNode))
  }
  return { index, parseError: false }
}

/** Template errors are build-time bugs: fail fast (06 §4.6.1). */
function parseTemplate(text) {
  const { index, parseError } = indexPatch(text)
  if (parseError) {
    throw new Error(
      '迁移模板解析失败：cordis.patch.yml 模板存在语法错误或顶层不是序列（06 §4.6.1：构建期 bug）。',
    )
  }
  return index
}

/** Projected provider table of the current template (for ADM group validation). */
function templateProviders(templateIndex) {
  const cfg = templateIndex?.rows.get('llm-pi-ai')
  return isPlainObject(cfg) ? cfg.providers : undefined
}

function leafFromConfig(index, rowId, leafParts) {
  const cfg = index?.rows.get(rowId)
  return hasOwn(cfg, leafParts[0]) ? getIn(cfg, leafParts) : undefined
}

// ---------------------------------------------------------------------------
// per-leaf extraction (06 §7.3 source priority)
// ---------------------------------------------------------------------------

const SIMPLE_LEAVES = [
  { path: 'subagent.maxActiveSubagents', row: 'subagent', leaf: ['maxActiveSubagents'], inprocOnly: false },
  { path: 'subagent.maxDepth', row: 'subagent', leaf: ['maxDepth'], inprocOnly: true },
  { path: 'session-log-deepseek.enabled', row: 'session-log-deepseek', leaf: ['enabled'], inprocOnly: false },
]

/**
 * Pick the first source that *has* the leaf (inproc first). Presence, not its
 * value, decides priority — an inproc value equal to the template is still a
 * no-op and must NOT fall back to the older opentui value (06 §7.3).
 */
function pickLeafSource(spec, inproc, opentui) {
  const sources = [['opentui-inproc', inproc]]
  if (!spec.inprocOnly) sources.push(['opentui', opentui])
  for (const [name, index] of sources) {
    if (!index) continue
    const value = leafFromConfig(index, spec.row, spec.leaf)
    if (value !== undefined) return { name, value }
  }
  return undefined
}

function validateSimpleLeaf(path, value) {
  if (isJsValue(value)) return { ok: false, reason: 'invalid-value' }
  if (path === 'session-log-deepseek.enabled') {
    return typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'invalid-value' }
  }
  // subagent.maxActiveSubagents / subagent.maxDepth
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return { ok: true }
  return { ok: false, reason: 'invalid-value' }
}

/** Source-side template default for a simple leaf (inproc: current template). */
function simpleDefault(path, sourceName, templateIndex) {
  if (sourceName === 'opentui') return OPENTUI_DEFAULTS[path]
  const spec = SIMPLE_LEAVES.find((s) => s.path === path)
  const fromTemplate = spec ? leafFromConfig(templateIndex, spec.row, spec.leaf) : undefined
  return fromTemplate !== undefined ? fromTemplate : OPENTUI_DEFAULTS[path]
}

// ---------------------------------------------------------------------------
// nested insert leaf: dsh-approval-policy.config.windowSeconds
// ---------------------------------------------------------------------------

/** Read windowSeconds from a source's dsh-approval-policy insert, if present. */
function approvalWindow(index) {
  if (!index || !index.insertRows.has(APPROVAL_POLICY_ID)) return undefined
  const cfg = index.insertRows.get(APPROVAL_POLICY_ID)
  return hasOwn(cfg, 'windowSeconds') ? cfg.windowSeconds : undefined
}

/** Per-leaf source priority: inproc first, fall back to opentui only when the
 *  inproc insert has no such leaf (presence, not value, decides). */
function pickApprovalWindow(inproc, opentui) {
  // A leaf present as `null` is still a user value (an invalid one), not an
  // absent leaf: approvalWindow returns null here, which this check keeps.
  const value = approvalWindow(inproc)
  if (value !== undefined) return { name: 'opentui-inproc', value }
  const fromOpentui = approvalWindow(opentui)
  if (fromOpentui !== undefined) return { name: 'opentui', value: fromOpentui }
  return undefined
}

/** Policy hard bound: finite number in [0, 86400]. Strings, NaN/Infinity and
 *  !!js markers are rejected so migration never widens the safety boundary. */
function validWindowSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400
}

// ---------------------------------------------------------------------------
// agent-default-model group (R22 — atomic, but per-leaf sources: 06 §7.3)
// ---------------------------------------------------------------------------

/** Mirror of converge's admGroupValid (T8a1) against the current template. */
function validateAdmGroup(group, providers) {
  if (typeof group.provider !== 'string' || typeof group.model !== 'string') {
    return { ok: false, reason: 'invalid-value' }
  }
  if (group.reasoningEffort !== undefined && typeof group.reasoningEffort !== 'string') {
    return { ok: false, reason: 'invalid-value' }
  }
  if (!isPlainObject(providers) || !hasOwn(providers, group.provider)) {
    return { ok: false, reason: 'model-id-not-in-template' }
  }
  const provider = providers[group.provider]
  const models = Array.isArray(provider.models) ? provider.models : []
  const model = models.find((m) => isPlainObject(m) && m.id === group.model)
  let found = !!model
  if (!found && isPlainObject(provider.modelOverrides) && hasOwn(provider.modelOverrides, group.model)) {
    found = true
  }
  if (!found) return { ok: false, reason: 'model-id-not-in-template' }
  if (group.reasoningEffort !== undefined && model && isPlainObject(model.reasoningEfforts) &&
      !hasOwn(model.reasoningEfforts, group.reasoningEffort)) {
    return { ok: false, reason: 'invalid-value' }
  }
  return { ok: true }
}

function admDefaults(sourceName, templateIndex) {
  if (sourceName === 'opentui') {
    return {
      provider: OPENTUI_DEFAULTS['agent-default-model.provider'],
      model: OPENTUI_DEFAULTS['agent-default-model.model'],
      reasoningEffort: OPENTUI_DEFAULTS['agent-default-model.reasoningEffort'],
    }
  }
  const cfg = templateIndex?.rows.get('agent-default-model')
  return {
    provider: hasOwn(cfg, 'provider') ? cfg.provider : OPENTUI_DEFAULTS['agent-default-model.provider'],
    model: hasOwn(cfg, 'model') ? cfg.model : OPENTUI_DEFAULTS['agent-default-model.model'],
    reasoningEffort: hasOwn(cfg, 'reasoningEffort')
      ? cfg.reasoningEffort
      : OPENTUI_DEFAULTS['agent-default-model.reasoningEffort'],
  }
}

/**
 * Resolve the ADM group leaf-by-leaf (inproc first), then validate the whole
 * group with R22. A bad group is dropped atomically, never half-carried.
 * Returns `{ values, drop, provenance }`.
 */
function planAdm(inproc, opentui, templateIndex) {
  const sources = [['opentui-inproc', inproc], ['opentui', opentui]]
  const group = {}
  /** @type {Record<string,string>} leaf -> contributing source */
  const provenance = {}
  for (const key of ['provider', 'model', 'reasoningEffort']) {
    for (const [name, index] of sources) {
      const cfg = index?.rows.get('agent-default-model')
      if (hasOwn(cfg, key)) {
        group[key] = cfg[key]
        provenance[key] = name
        break
      }
    }
  }
  if (Object.keys(group).length === 0) {
    // A present-but-unusable row is still a rejected migration, not a silent skip.
    for (const [name, index] of sources) {
      if (index && index.rows.has('agent-default-model') && !isPlainObject(index.rows.get('agent-default-model'))) {
        return { values: undefined, drop: { path: 'agent-default-model', reason: 'invalid-value', source: name } }
      }
    }
    return { values: undefined, drop: undefined, provenance }
  }

  const verdict = validateAdmGroup(group, templateProviders(templateIndex))
  if (!verdict.ok) {
    const source = provenance.provider || provenance.model || provenance.reasoningEffort || 'opentui-inproc'
    return { values: undefined, drop: { path: 'agent-default-model', reason: verdict.reason, source }, provenance }
  }

  // R22 is atomic: if ANY leaf deviates from its source-side default, the
  // whole group is carried (including leaves equal to the template).
  const deviates = Object.keys(group).some((key) =>
    !deepEqual(group[key], admDefaults(provenance[key], templateIndex)[key]))
  if (!deviates) return { values: undefined, drop: undefined, provenance }

  const values = {}
  for (const key of Object.keys(group)) values[`agent-default-model.${key}`] = cloneValue(group[key])
  return { values, drop: undefined, provenance }
}

// ---------------------------------------------------------------------------
// forbidden-item reporting (06 §7.2/§7.3, §7.5 reason codes)
// ---------------------------------------------------------------------------

function collectForbidden(sourceName, index, templateIndex, out) {
  const add = (path, reason) => out.push({ id: sourceName, path, reason })

  const permission = index.rows.get('permission')
  if (isPlainObject(permission)) {
    if (hasOwn(permission, 'defaultPreset')) add('permission.defaultPreset', 'template-authority')
    if (hasOwn(permission, 'presets')) add('permission.presets', 'sandbox-loosening-forbidden')
  }

  const llm = index.rows.get('llm-pi-ai')
  if (isPlainObject(llm) && hasOwn(llm, 'providers')) {
    add('llm-pi-ai.providers', 'model-table-template-owned')
    const templateProvs = templateProviders(templateIndex)
    const sourceProvs = llm.providers
    if (isPlainObject(sourceProvs)) {
      for (const id of Object.keys(sourceProvs)) {
        if (!hasOwn(templateProvs, id)) add(`providers.${id}`, 'credentials-channel-pending')
      }
      // P1-2: only ids that ACTUALLY occur in the source table are reported.
      // Never fabricate the four removed ids into the audit array.
      for (const oldId of OLD_MODEL_IDS) {
        for (const provider of Object.values(sourceProvs)) {
          const models = isPlainObject(provider) && Array.isArray(provider.models) ? provider.models : []
          if (models.some((m) => isPlainObject(m) && m.id === oldId)) {
            add(`model.${oldId}`, 'model-id-not-in-template')
            break
          }
        }
      }
    }
  }

  for (const insert of index.inserts) {
    const isAppendBlock = insert.ids.includes(APPEND_PRESET_ID)
    for (const id of insert.ids) {
      if (isAppendBlock) add(`insert.${id}`, 'append-preset-unused')
      else if (DUPLICATE_INSERT_IDS.has(id)) add(`insert.${id}`, 'duplicate-insert')
    }
  }
  for (const id of index.rows.keys()) {
    if (DEAD_ROW_IDS.has(id)) add(id, 'dead-row-no-bundle')
    // Template-owned rows DO exist in the template — they are regenerated,
    // not dead. 06 §7.5 calls this `row-replaced-by-leaf` for both sources.
    else if (TEMPLATE_OWNED_ROW_IDS.has(id)) add(id, 'row-replaced-by-leaf')
  }
}

/** P2-7: recognizable user values under carry rows that are not whitelisted. */
function collectUnknownLeaves(sourceName, index, out, unknownPaths) {
  for (const [rowId, cfg] of index.rows) {
    const allowed = hasOwn(CARRY_LEAF_KEYS, rowId) ? CARRY_LEAF_KEYS[rowId] : undefined
    if (!allowed || !isPlainObject(cfg)) continue
    for (const key of Object.keys(cfg)) {
      if (allowed.has(key)) continue
      const path = `${rowId}.${key}`
      out.push({ id: sourceName, path, reason: 'invalid-value' })
      unknownPaths.push(path)
    }
  }
}

/** P2-6: pass through source A text, but flag invalid JSON instead of
 *  silently presenting it as a legal payload. T8b decides reject vs backup. */
function jsonPayload(text) {
  if (typeof text !== 'string') return undefined
  try {
    JSON.parse(text)
    return { source: 'opentui', text }
  } catch {
    return { source: 'opentui', text, invalid: true }
  }
}

// ---------------------------------------------------------------------------
// main export
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @returns {{
 *   externalCarry: {source:string, values:Record<string,unknown>, dropped:{path:string,reason:string}[]}|undefined,
 *   config: {source:'opentui', text:string, invalid?:boolean}|undefined,
 *   keybindings: {source:'opentui', text:string, invalid?:boolean}|undefined,
 *   backups: {source:string, kind:string, text:string}[],
 *   marker: {from:string[], migrated:string[], dropped:{id:string,path:string,reason:string}[]}|undefined,
 *   notices: string[],
 *   canWriteMarker: boolean
 * }}
 */
export function planMigration({
  markerExists,
  inprocPatchText,
  opentuiPatchText,
  templatePatchText,
  opentuiConfigText,
  opentuiKeybindingsText,
  opentuiProviderKeysText,
} = {}) {
  // Marker present: skip everything, do NOT even parse the (possibly corrupt)
  // legacy text. Nothing must be written in this branch.
  if (markerExists === true) {
    return {
      externalCarry: undefined,
      config: undefined,
      keybindings: undefined,
      backups: [],
      marker: undefined,
      notices: ['检测到迁移 marker（.migration.json），此前已迁移，跳过迁移并直接收敛。'],
      canWriteMarker: false,
    }
  }

  const hasInprocPatch = typeof inprocPatchText === 'string' && inprocPatchText.length > 0
  const hasOpentuiPatch = typeof opentuiPatchText === 'string' && opentuiPatchText.length > 0
  const hasAnyOldPatch = hasInprocPatch || hasOpentuiPatch

  const templateIndex = parseTemplate(templatePatchText)
  const inprocParsed = hasInprocPatch ? indexPatch(inprocPatchText) : undefined
  const opentuiParsed = hasOpentuiPatch ? indexPatch(opentuiPatchText) : undefined
  const inproc = inprocParsed?.index
  const opentui = opentuiParsed?.index

  // ---- dropped bookkeeping (id + path + reason) --------------------------
  /** @type {{id:string,path:string,reason:string}[]} */
  const dropped = []
  /** @type {string[]} paths of unrecognized user leaves, for the notice */
  const unknownPaths = []
  /** @type {string[]} sources whose legacy patch could not be parsed */
  const parseFailures = []
  if (inprocParsed?.parseError) {
    parseFailures.push('opentui-inproc')
    dropped.push({ id: 'opentui-inproc', path: 'opentui-inproc-cordis.patch.yml', reason: 'invalid-value' })
  }
  if (opentuiParsed?.parseError) {
    parseFailures.push('opentui')
    dropped.push({ id: 'opentui', path: 'opentui-cordis.patch.yml', reason: 'invalid-value' })
  }
  if (inproc) collectForbidden('opentui-inproc', inproc, templateIndex, dropped)
  if (opentui) collectForbidden('opentui', opentui, templateIndex, dropped)
  if (inproc) collectUnknownLeaves('opentui-inproc', inproc, dropped, unknownPaths)
  if (opentui) collectUnknownLeaves('opentui', opentui, dropped, unknownPaths)
  // P1-2: the four removed model ids appear in `dropped` ONLY when the source
  // provider table actually contains them (see collectForbidden). A release
  // note about the smaller selector is emitted separately, never as an audit
  // entry.

  // de-duplicate identical (path,reason) pairs coming from both sources
  const seenDrop = new Set()
  const uniqueDropped = dropped.filter((d) => {
    const key = `${d.path}|${d.reason}`
    if (seenDrop.has(key)) return false
    seenDrop.add(key)
    return true
  })

  // ---- externalCarry.values ---------------------------------------------
  /** @type {Record<string, unknown>} */
  const values = {}
  /** @type {string[]} */
  const migrated = []
  /** @type {Record<string,string>} path -> contributing source */
  const valueSource = {}
  let carriedFromInproc = false

  for (const spec of SIMPLE_LEAVES) {
    const picked = pickLeafSource(spec, inproc, opentui)
    if (!picked) continue
    const verdict = validateSimpleLeaf(spec.path, picked.value)
    if (!verdict.ok) {
      uniqueDropped.push({ id: picked.name, path: spec.path, reason: verdict.reason })
      continue
    }
    const def = simpleDefault(spec.path, picked.name, templateIndex)
    if (def !== undefined && deepEqual(picked.value, def)) continue
    values[spec.path] = cloneValue(picked.value)
    valueSource[spec.path] = picked.name
    migrated.push(spec.path)
    if (picked.name === 'opentui-inproc') carriedFromInproc = true
  }

  // Nested insert leaf. The source-side default is the template's own window
  // (300 in the shipped template); only a source that actually carries the
  // insert leaf is a user value. Invalid values are dropped per leaf and do
  // not stop the other leaves from migrating.
  const tplWindowCfg = templateIndex.insertRows.get(APPROVAL_POLICY_ID)
  const tplWindow = hasOwn(tplWindowCfg, 'windowSeconds') ? tplWindowCfg.windowSeconds : undefined
  if (tplWindow !== undefined) {
    const picked = pickApprovalWindow(inproc, opentui)
    if (picked) {
      if (!validWindowSeconds(picked.value)) {
        uniqueDropped.push({ id: picked.name, path: WINDOW_SECONDS_PATH, reason: 'invalid-value' })
      } else if (!deepEqual(picked.value, tplWindow)) {
        values[WINDOW_SECONDS_PATH] = cloneValue(picked.value)
        valueSource[WINDOW_SECONDS_PATH] = picked.name
        migrated.push(WINDOW_SECONDS_PATH)
        if (picked.name === 'opentui-inproc') carriedFromInproc = true
      }
    }
  }

  const adm = planAdm(inproc, opentui, templateIndex)
  if (adm.drop) uniqueDropped.push({ id: adm.drop.source, path: adm.drop.path, reason: adm.drop.reason })
  if (adm.values) {
    for (const [path, value] of Object.entries(adm.values)) {
      const leaf = path.slice('agent-default-model.'.length)
      values[path] = value
      valueSource[path] = adm.provenance[leaf] || 'opentui-inproc'
      migrated.push(path)
      if (valueSource[path] === 'opentui-inproc') carriedFromInproc = true
    }
  }

  // ext is only meaningful when at least one legacy patch existed. Even a
  // no-op patch still yields an ext (with `dropped`) so converge surfaces the
  // forbidden items; we never fabricate ext for a clean home.
  let externalCarry
  if (hasAnyOldPatch) {
    const fromOpentui = Object.keys(valueSource).some((p) => valueSource[p] === 'opentui')
    externalCarry = {
      source: carriedFromInproc || (!fromOpentui && hasInprocPatch) ? 'opentui-inproc' : 'opentui',
      values: cloneValue(values),
      dropped: uniqueDropped.map(({ path, reason }) => ({ path, reason })),
    }
  }

  // ---- config / keybindings (source A only) ------------------------------
  const config = jsonPayload(opentuiConfigText)
  const keybindings = jsonPayload(opentuiKeybindingsText)

  // ---- backups: two legacy patches + provider-keys (if present) ----------
  /** @type {{source:string,kind:string,text:string}[]} */
  const backups = []
  if (hasInprocPatch) backups.push({ source: 'opentui-inproc', kind: 'cordis.patch.yml', text: inprocPatchText })
  if (hasOpentuiPatch) backups.push({ source: 'opentui', kind: 'cordis.patch.yml', text: opentuiPatchText })
  const hasProviderKeys = typeof opentuiProviderKeysText === 'string' && opentuiProviderKeysText.length > 0
  if (hasProviderKeys) backups.push({ source: 'opentui', kind: 'provider-keys.json', text: opentuiProviderKeysText })

  // ---- marker (caller adds at/version/digest) ----------------------------
  const hasAnyLegacyArtifact = hasAnyOldPatch || !!config || !!keybindings || hasProviderKeys
  /** @type {{from:string[],migrated:string[],dropped:{id:string,path:string,reason:string}[]}|undefined} */
  let marker
  if (hasAnyLegacyArtifact) {
    const from = []
    if (hasInprocPatch) from.push('opentui-inproc')
    if (hasOpentuiPatch || config || keybindings || hasProviderKeys) from.push('opentui')
    marker = {
      from,
      migrated: [...migrated],
      dropped: uniqueDropped.map((d) => ({ ...d })),
    }
  }

  // P1-1: a bad legacy patch is backed up but MUST NOT leave a marker — T8b
  // uses this flag to skip the write, so the next start retries the migration.
  const canWriteMarker = parseFailures.length === 0

  // ---- notices (user-visible, 06 §7.5) ----------------------------------
  const notices = []
  for (const source of parseFailures) {
    notices.push(`dropped ${source}-cordis.patch.yml reason=invalid-value`)
    notices.push(`${source} 的旧 patch 解析失败，已备份但未迁移/未写入新 profile，请修复后等待下次启动重试。`)
  }
  // A clean home has nothing to migrate — no summary, no approval, no model note.
  if (hasAnyLegacyArtifact && parseFailures.length === 0) {
    notices.push(`迁移完成：迁入 ${migrated.length} 项，丢弃 ${uniqueDropped.length} 项，备份 ${backups.length} 份。`)
  }
  // 06 §7.5.4: only claim the approval default if it was actually discarded.
  if (uniqueDropped.some((d) => d.path === 'permission.defaultPreset')) {
    notices.push('审批默认档位保持 workspace-write；如需放开请在 /permission 里改。')
  }
  if (hasAnyOldPatch) {
    // Release note only (P1-2): the selector has four fewer entries. Never a
    // claim that these were read from, or dropped out of, the source table.
    notices.push(`以下 4 个旧模型 id 已从新模板移除（选择器少 4 项）：${OLD_MODEL_IDS.join('、')}。`)
  }
  if (unknownPaths.length > 0) {
    notices.push(`以下未知字段未迁移（已丢弃）：${[...new Set(unknownPaths)].join('、')}。`)
  }
  if (config) {
    if (config.invalid) {
      notices.push('config.json 解析失败：已备份、未写入新 profile，需人工修复；原文原样保留。')
    } else {
      let unknown = []
      try {
        const parsed = JSON.parse(opentuiConfigText)
        if (isPlainObject(parsed)) unknown = Object.keys(parsed).filter((k) => !KNOWN_CONFIG_KEYS.has(k))
      } catch {
        notices.push('config.json 解析失败：将原文原样保留，请人工检查。')
      }
      if (unknown.length > 0) notices.push(`config.json 已整份保留，未知键未丢弃：${unknown.join('、')}。`)
    }
  }
  if (keybindings) {
    if (keybindings.invalid) {
      notices.push('keybindings.json 解析失败：已备份、未写入新 profile，需人工修复；原文原样保留。')
    } else {
      notices.push('keybindings.json 已整份带回。')
    }
  }
  if (hasProviderKeys) {
    notices.push('旧 provider-keys.json 已备份；新版请重新 /login，宿主凭据在 ~/.dsh/.credentials.yaml。')
  }

  return { externalCarry, config, keybindings, backups, marker, notices, canWriteMarker }
}

export default planMigration
