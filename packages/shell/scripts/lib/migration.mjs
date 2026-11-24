/**
 * T8 — one-shot migration planner (pure function; no fs / no clock / no env).
 *
 * Given the text of the two legacy profiles plus the current new template,
 * produce everything T8b needs to write: the `externalCarry` payload consumed
 * by `converge` (T8a1), the config/keybindings payloads, the backup manifest,
 * the marker (minus at/version/digest, which the caller fills), and a set of
 * user-visible notices.
 *
 * Design refs: 06 §4.5, §7.1–7.5; D6; D8-Q2; handoff §二.
 *
 * Hard rules encoded here:
 *  - source priority is per-leaf (opentui-inproc first), never "fall back
 *    because the inproc value happens to equal the template" (06 §7.3);
 *  - only values that deviate from the *source-side* template default become
 *    ext entries (06 R21 / §4.5.1);
 *  - forbidden families (permission / providers / inserts / old rows) and the
 *    four removed model ids are reported as `dropped`, never carried;
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
// patch parsing
// ---------------------------------------------------------------------------

/**
 * Parse a patch into `{ rows: Map<id, projectedConfig>, inserts: [{target, ids}] }`.
 * Malformed / absent text yields an empty index (never throws): a legacy patch
 * we cannot read simply has nothing to migrate.
 */
function indexPatch(text) {
  const index = { rows: new Map(), inserts: [] }
  if (typeof text !== 'string' || text.length === 0) return index
  let doc
  try {
    doc = parseDocument(text, { customTags: jsCustomTags })
  } catch {
    return index
  }
  if (!doc || !isSeq(doc.contents)) return index
  for (const item of doc.contents.items) {
    if (!isMap(item)) continue
    const insertNode = item.get('insert', true)
    if (isSeq(insertNode)) {
      const ids = []
      for (const entry of insertNode.items) {
        if (isMap(entry)) {
          const id = scalarOf(entry.get('id', true))
          if (id !== undefined && id !== null) ids.push(String(id))
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
// agent-default-model group (R22 — atomic)
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
 * Resolve the whole ADM group from the first source carrying the row. Returns
 * `{ values, drop }`; a bad group is dropped atomically, never half-carried.
 */
function planAdm(inproc, opentui, templateIndex) {
  let sourceName, cfg
  if (inproc && inproc.rows.has('agent-default-model')) {
    sourceName = 'opentui-inproc'
    cfg = inproc.rows.get('agent-default-model')
  } else if (opentui && opentui.rows.has('agent-default-model')) {
    sourceName = 'opentui'
    cfg = opentui.rows.get('agent-default-model')
  } else {
    return { values: undefined, drop: undefined }
  }
  if (!isPlainObject(cfg)) {
    return { values: undefined, drop: { path: 'agent-default-model', reason: 'invalid-value', source: sourceName } }
  }
  const group = {}
  for (const key of ['provider', 'model', 'reasoningEffort']) {
    if (hasOwn(cfg, key)) group[key] = cfg[key]
  }
  const verdict = validateAdmGroup(group, templateProviders(templateIndex))
  if (!verdict.ok) {
    return { values: undefined, drop: { path: 'agent-default-model', reason: verdict.reason, source: sourceName } }
  }
  const defaults = admDefaults(sourceName, templateIndex)
  const deviates = Object.keys(group).some((k) => !deepEqual(group[k], defaults[k]))
  if (!deviates) return { values: undefined, drop: undefined }
  const values = {}
  for (const key of Object.keys(group)) values[`agent-default-model.${key}`] = cloneValue(group[key])
  return { values, drop: undefined }
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
    for (const id of insert.ids) {
      if (id === APPEND_PRESET_ID) add(`insert.${id}`, 'append-preset-unused')
      else if (DUPLICATE_INSERT_IDS.has(id)) add(`insert.${id}`, 'duplicate-insert')
    }
  }
  for (const id of index.rows.keys()) {
    if (DEAD_ROW_IDS.has(id)) add(id, 'dead-row-no-bundle')
    else if (TEMPLATE_OWNED_ROW_IDS.has(id) && sourceName === 'opentui') add(id, 'dead-row-no-bundle')
  }
}

// ---------------------------------------------------------------------------
// main export
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @returns {{
 *   externalCarry: {source:string, values:Record<string,unknown>, dropped:{path:string,reason:string}[]}|undefined,
 *   config: {source:'opentui', text:string}|undefined,
 *   keybindings: {source:'opentui', text:string}|undefined,
 *   backups: {source:string, kind:string, text:string}[],
 *   marker: {from:string[], migrated:string[], dropped:{id:string,path:string,reason:string}[]}|undefined,
 *   notices: string[]
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
  // legacy text. Prove with bad-YAML fixtures that no read happens.
  if (markerExists === true) {
    return {
      externalCarry: undefined,
      config: undefined,
      keybindings: undefined,
      backups: [],
      marker: undefined,
      notices: ['检测到迁移 marker（.migration.json），此前已迁移，跳过迁移并直接收敛。'],
    }
  }

  const hasInprocPatch = typeof inprocPatchText === 'string' && inprocPatchText.length > 0
  const hasOpentuiPatch = typeof opentuiPatchText === 'string' && opentuiPatchText.length > 0
  const hasAnyOldPatch = hasInprocPatch || hasOpentuiPatch

  const templateIndex = indexPatch(templatePatchText)
  const inproc = hasInprocPatch ? indexPatch(inprocPatchText) : undefined
  const opentui = hasOpentuiPatch ? indexPatch(opentuiPatchText) : undefined

  // ---- dropped bookkeeping (id + path + reason) --------------------------
  /** @type {{id:string,path:string,reason:string}[]} */
  const dropped = []
  if (inproc) collectForbidden('opentui-inproc', inproc, templateIndex, dropped)
  if (opentui) collectForbidden('opentui', opentui, templateIndex, dropped)
  // 06 §7.5: the four removed model ids are always named, even if a synthetic
  // fixture happens not to contain them (they are gone from the new template).
  const reportedModels = new Set(
    dropped.filter((d) => d.path.startsWith('model.')).map((d) => d.path.slice('model.'.length)),
  )
  if (hasAnyOldPatch) {
    for (const id of OLD_MODEL_IDS) {
      if (!reportedModels.has(id)) dropped.push({ id: 'opentui', path: `model.${id}`, reason: 'model-id-not-in-template' })
    }
  }
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

  const adm = planAdm(inproc, opentui, templateIndex)
  if (adm.drop) uniqueDropped.push({ id: adm.drop.source, path: adm.drop.path, reason: adm.drop.reason })
  if (adm.values) {
    for (const [path, value] of Object.entries(adm.values)) {
      values[path] = value
      valueSource[path] = inproc && inproc.rows.has('agent-default-model') ? 'opentui-inproc' : 'opentui'
      migrated.push(path)
    }
    if (inproc && inproc.rows.has('agent-default-model')) carriedFromInproc = true
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
  const config = typeof opentuiConfigText === 'string'
    ? { source: 'opentui', text: opentuiConfigText }
    : undefined
  const keybindings = typeof opentuiKeybindingsText === 'string'
    ? { source: 'opentui', text: opentuiKeybindingsText }
    : undefined

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

  // ---- notices (user-visible, 06 §7.5) ----------------------------------
  const notices = []
  notices.push(`迁移完成：迁入 ${migrated.length} 项，丢弃 ${uniqueDropped.length} 项，备份 ${backups.length} 份。`)
  notices.push('审批默认档位保持 workspace-write；如需放开请在 /permission 里改。')
  if (hasAnyOldPatch) {
    notices.push(`以下旧模型 id 在新模板中不存在，已丢弃：${OLD_MODEL_IDS.join('、')}。`)
  }
  if (config) {
    let unknown = []
    try {
      const parsed = JSON.parse(opentuiConfigText)
      if (isPlainObject(parsed)) unknown = Object.keys(parsed).filter((k) => !KNOWN_CONFIG_KEYS.has(k))
    } catch {
      notices.push('config.json 解析失败：将原文原样保留，请人工检查。')
    }
    if (unknown.length > 0) notices.push(`config.json 已整份保留，未知键未丢弃：${unknown.join('、')}。`)
  }
  if (keybindings) notices.push('keybindings.json 已整份带回。')
  if (hasProviderKeys) {
    notices.push('旧 provider-keys.json 已备份；新版请重新 /login，宿主凭据在 ~/.dsh/.credentials.yaml。')
  }

  return { externalCarry, config, keybindings, backups, marker, notices }
}

export default planMigration
