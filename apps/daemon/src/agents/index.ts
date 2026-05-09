// @ts-nocheck
/**
 * Agent modules barrel file.
 *
 * Re-exports the full agent surface from the four extraction modules:
 *   - adapters.ts  — agent definitions, types, lookup helpers
 *   - detect.ts    — PATH scanning, binary resolution, probing, model validation
 *   - spawn.ts     — child-process spawning, prompt composition, lifecycle
 *   - stream.ts    — per-format stream routing, event normalization
 *
 * Downstream consumers (server.ts, routes, tests) should import from this
 * barrel rather than reaching into individual sub-modules.
 */

// ── Adapters ────────────────────────────────────────────────────────────────
export {
  AGENT_DEFS,
  AGENT_BIN_ENV_KEYS,
  agentCapabilities,
  getAgentDef,
} from './adapters.js';
export type {
  AgentDef,
  ModelOption,
  ReasoningOption,
  ListModelsSpec,
  StreamFormat,
} from './adapters.js';

// ── Detection & Resolution ──────────────────────────────────────────────────
export {
  detectAgents,
  resolveOnPath,
  resolveAgentExecutable,
  resolveAgentBin,
  spawnEnvForAgent,
  isKnownModel,
  sanitizeCustomModel,
  rememberLiveModels,
  buildLiveArtifactsMcpServersForAgent,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
} from './detect.js';

// ── Spawning & Lifecycle ────────────────────────────────────────────────────
export {
  spawnAgentChild,
  composePrompt,
  resolveSafeModel,
  resolveSafeReasoning,
  createAgentRuntimeEnv,
} from './spawn.js';
export type {
  SpawnOptions,
  SpawnResult,
  ComposePromptInput,
  AgentRuntimeEnvParams,
} from './spawn.js';

// ── Stream Routing & Events ─────────────────────────────────────────────────
export {
  routeStreamByFormat,
  SUBSTANTIVE_AGENT_EVENT_TYPES,
  isSubstantiveEvent,
  createSseErrorPayload,
  checkEmptyOutputGuard,
} from './stream.js';
export type {
  StreamEvent,
  EventSink,
  StreamRouteParams,
  StreamRouteResult,
  EmptyOutputGuardResult,
} from './stream.js';
