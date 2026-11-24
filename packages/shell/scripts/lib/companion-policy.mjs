// D2 user decision (2026-11-24): the companion IDs installed by default for
// the opentui-monday profile. IDs match `COMPANIONS[].short`; package specs and
// version guards stay in the catalog. `workflow` was explicitly dropped.
export const DEFAULT_COMPANION_IDS = [
  'registry',
  'ask-router',
  'approval-policy',
  'llm-net-retry',
  'model-sync',
  'llm-stats',
  'mcp-adapter',
  'vault',
  'web-search',
  'topics-memory',
  'cron',
]
