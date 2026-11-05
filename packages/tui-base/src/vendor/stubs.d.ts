// Vendored-seam stubs for @opencode/tui's workspace siblings that were NOT
// vendored into tui-base (ADR-0006 decision 1: theme/ui/util + schema came
// along; the rest are stubbed). TYPE-ONLY: runtime resolution is the
// view-rebuild's job. Regenerate from actual imports when re-vendoring.
// Stubbed: client, plugin, simulation, core, merman, latex.
// Shapes verified by probe: plain name -> const(+alias when value-imported);
// qualified name -> alias + namespace (a `const` would suppress the
// namespace meaning in ambient modules); namespace members type-only
// unless observed in value use.

declare module "@opencode/client" {
export type AgentListOutput = any

export const ClientError: any
export type ClientError = any

export const ClientMcpConnection: any
export type ClientMcpConnection = any

export type CommandListOutput = any

export type ConnectionInfo = any

export const Endpoint: any
export type Endpoint = any

export type EventSubscribeOutput = any

export type FileDiffInfo = any

export type FileSystemEntry = any

export type FormAnswer = any

export type FormField = any

export type FormFields = any

export type FormInfo = any

export type FormValue = any

export const FormWithLocation: any
export type FormWithLocation = any

export type IntegrationCommandConnectOutput = any

export type IntegrationInfo = any

export type IntegrationOAuthMethod = any

export type IntegrationOauthConnectOutput = any

export type JsonValue = any

export const LocationGetOutput: any
export type LocationGetOutput = any

export const LocationRef: any
export type LocationRef = any

export type McpServer = any

export const ModelInfo: any
export type ModelInfo = any

export type ModelListOutput = any

export type OpenCode = any
export namespace OpenCode {
  export const make: any
}

export const OpenCodeClient: any
export type OpenCodeClient = any

export type OpenCodeEvent = any

export type PermissionReply = any

export type PermissionRequest = any

export type PersistentPtyInfo = any

export type PluginInfo = any

export const PromptAttachment: any
export type PromptAttachment = any

export type ProviderListOutput = any

export type ReferenceListOutput = any

export type Service = any
export namespace Service {
  export const headers: any
  export const of: any
}

export type SessionInboxEnqueued = any

export type SessionInboxInfo = any

export type SessionInfo = any
export namespace SessionInfo {
  export type Type = any
}

export const SessionMessageAssistant: any
export type SessionMessageAssistant = any

export const SessionMessageAssistantReasoning: any
export type SessionMessageAssistantReasoning = any

export const SessionMessageAssistantText: any
export type SessionMessageAssistantText = any

export const SessionMessageAssistantTool: any
export type SessionMessageAssistantTool = any

export const SessionMessageInfo: any
export type SessionMessageInfo = any

export type SessionMessageToolStateCompleted = any

export const SessionMessageUser: any
export type SessionMessageUser = any

export type SessionStatsInfo = any

export const ShellInfo: any
export type ShellInfo = any

export type UsageLimitsBudget = any

export type UsageLimitsInfo = any

export type VcsFileStatus = any

export type WorktreeListOutput = any

export const connectClientMcp: any
export type connectClientMcp = any

export const createClientConnection: any
export type createClientConnection = any

export const createData: any
export type createData = any

export const createPersistentPtyClient: any
export type createPersistentPtyClient = any

export const createSessionRetention: any
export type createSessionRetention = any

export const decodePersistentPtyMessage: any
export type decodePersistentPtyMessage = any

export const isLocationNotFoundError: any
export type isLocationNotFoundError = any

export const isShellNotFoundError: any
export type isShellNotFoundError = any

export const lastAssistantWithUsage: any
export type lastAssistantWithUsage = any

export const locationKey: any

export const mediaHashFromUri: any
export type mediaHashFromUri = any

export const persistentPtyFrame: any
export type persistentPtyFrame = any

export const withMediaRefs: any
export type withMediaRefs = any
}

declare module "@opencode/client/*" {
export type AgentListOutput = any

export const ClientError: any
export type ClientError = any

export const ClientMcpConnection: any
export type ClientMcpConnection = any

export type CommandListOutput = any

export type ConnectionInfo = any

export const Endpoint: any
export type Endpoint = any

export type EventSubscribeOutput = any

export type FileDiffInfo = any

export type FileSystemEntry = any

export type FormAnswer = any

export type FormField = any

export type FormFields = any

export type FormInfo = any

export type FormValue = any

export const FormWithLocation: any
export type FormWithLocation = any

export type IntegrationCommandConnectOutput = any

export type IntegrationInfo = any

export type IntegrationOAuthMethod = any

export type IntegrationOauthConnectOutput = any

export type JsonValue = any

export const LocationGetOutput: any
export type LocationGetOutput = any

export const LocationRef: any
export type LocationRef = any

export type McpServer = any

export const ModelInfo: any
export type ModelInfo = any

export type ModelListOutput = any

export type OpenCode = any
export namespace OpenCode {
  export const make: any
}

export const OpenCodeClient: any
export type OpenCodeClient = any

export type OpenCodeEvent = any

export type PermissionReply = any

export type PermissionRequest = any

export type PersistentPtyInfo = any

export type PluginInfo = any

export const PromptAttachment: any
export type PromptAttachment = any

export type ProviderListOutput = any

export type ReferenceListOutput = any

export type Service = any
export namespace Service {
  export const headers: any
  export const of: any
}

export type SessionInboxEnqueued = any

export type SessionInboxInfo = any

export type SessionInfo = any
export namespace SessionInfo {
  export type Type = any
}

export const SessionMessageAssistant: any
export type SessionMessageAssistant = any

export const SessionMessageAssistantReasoning: any
export type SessionMessageAssistantReasoning = any

export const SessionMessageAssistantText: any
export type SessionMessageAssistantText = any

export const SessionMessageAssistantTool: any
export type SessionMessageAssistantTool = any

export const SessionMessageInfo: any
export type SessionMessageInfo = any

export type SessionMessageToolStateCompleted = any

export const SessionMessageUser: any
export type SessionMessageUser = any

export type SessionStatsInfo = any

export const ShellInfo: any
export type ShellInfo = any

export type UsageLimitsBudget = any

export type UsageLimitsInfo = any

export type VcsFileStatus = any

export type WorktreeListOutput = any

export const connectClientMcp: any
export type connectClientMcp = any

export const createClientConnection: any
export type createClientConnection = any

export const createData: any
export type createData = any

export const createPersistentPtyClient: any
export type createPersistentPtyClient = any

export const createSessionRetention: any
export type createSessionRetention = any

export const decodePersistentPtyMessage: any
export type decodePersistentPtyMessage = any

export const isLocationNotFoundError: any
export type isLocationNotFoundError = any

export const isShellNotFoundError: any
export type isShellNotFoundError = any

export const lastAssistantWithUsage: any
export type lastAssistantWithUsage = any

export const locationKey: any

export const mediaHashFromUri: any
export type mediaHashFromUri = any

export const persistentPtyFrame: any
export type persistentPtyFrame = any

export const withMediaRefs: any
export type withMediaRefs = any
}

declare module "@opencode/plugin" {
export type Attention = any

export type AttentionNotifyOptions = any

export type AttentionNotifyResult = any

export type AttentionNotifySkipReason = any

export type AttentionSoundName = any

export type AttentionWhen = any

export type Context = any
export namespace Context {
  export type Context = any
  export type Key = any
  export type Provider = any
  export type Service = any
  export namespace Service {
    export type Any = any
  }
  export const get: any
}

export type Dialog = any

export type DialogSelectOptions = any

export type Host = any
export namespace Host {
  export type Target = any
  export const load: any
  export const resolve: any
}

export type KeymapActive = any

export const KeymapCommand: any
export type KeymapCommand = any

export const KeymapLayer: any
export type KeymapLayer = any

export type KeymapPending = any

export type Page = any

export type PanelInput = any

export type PanelPresentation = any

export type Plugin = any
export namespace Plugin {
  export type Context = any
  export type Definition = any
  export type Features = any
  export type GuiBundle = any
  export type ID = any
  export type Info = any
  export type Source = any
  export type State = any
  export type Type = any
  export const define: any
  export const pipe: any
}

export const PluginContextProvider: any
export type PluginContextProvider = any

export type Route = any

export type SlotClaim = any

export type SlotMap = any

export type SlotPath = any

export type Toast = any

export const createPluginSources: any

export const ensurePluginRuntime: any
export type ensurePluginRuntime = any

export const localSource: any
export type localSource = any

export const provides: any
export type provides = any

export const usePlugin: any
export type usePlugin = any
}

declare module "@opencode/plugin/*" {
export type Attention = any

export type AttentionNotifyOptions = any

export type AttentionNotifyResult = any

export type AttentionNotifySkipReason = any

export type AttentionSoundName = any

export type AttentionWhen = any

export type Context = any
export namespace Context {
  export type Context = any
  export type Key = any
  export type Provider = any
  export type Service = any
  export namespace Service {
    export type Any = any
  }
  export const get: any
}

export type Dialog = any

export type DialogSelectOptions = any

export type Host = any
export namespace Host {
  export type Target = any
  export const load: any
  export const resolve: any
}

export type KeymapActive = any

export const KeymapCommand: any
export type KeymapCommand = any

export const KeymapLayer: any
export type KeymapLayer = any

export type KeymapPending = any

export type Page = any

export type PanelInput = any

export type PanelPresentation = any

export type Plugin = any
export namespace Plugin {
  export type Context = any
  export type Definition = any
  export type Features = any
  export type GuiBundle = any
  export type ID = any
  export type Info = any
  export type Source = any
  export type State = any
  export type Type = any
  export const define: any
  export const pipe: any
}

export const PluginContextProvider: any
export type PluginContextProvider = any

export type Route = any

export type SlotClaim = any

export type SlotMap = any

export type SlotPath = any

export type Toast = any

export const createPluginSources: any

export const ensurePluginRuntime: any
export type ensurePluginRuntime = any

export const localSource: any
export type localSource = any

export const provides: any
export type provides = any

export const usePlugin: any
export type usePlugin = any
}

declare module "@opencode/simulation" {
export const Drive: any
export type Drive = any

export type SimulationProtocol = any
export namespace SimulationProtocol {
  export type Frontend = any
  export namespace Frontend {
    export type SemanticNode = any
  }
}
}

declare module "@opencode/simulation/*" {
export const Drive: any
export type Drive = any

export type SimulationProtocol = any
export namespace SimulationProtocol {
  export type Frontend = any
  export namespace Frontend {
    export type SemanticNode = any
  }
}
}

declare module "@opencode/core" {
export type Slug = any
export namespace Slug {
  export const create: any
}
}

declare module "@opencode/core/*" {
export type Slug = any
export namespace Slug {
  export const create: any
}
}

declare module "@opencode/merman" {
const __default: any
export default __default
}

declare module "@opencode/merman/*" {
const __default: any
export default __default
}

declare module "@opencode/latex" {
const __default: any
export default __default
}

declare module "@opencode/latex/*" {
const __default: any
export default __default
}
