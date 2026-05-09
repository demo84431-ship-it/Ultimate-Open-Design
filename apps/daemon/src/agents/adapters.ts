// @ts-nocheck
/**
 * Agent adapter definitions.
 *
 * Each entry in AGENT_DEFS describes one CLI agent the daemon can spawn:
 *   - identity (id, name, bin, fallbackBins)
 *   - probing (versionArgs, helpArgs, capabilityFlags)
 *   - model selection (listModels, fetchModels, fallbackModels, reasoningOptions)
 *   - spawn contract (buildArgs, promptViaStdin, streamFormat, env, maxPromptArgBytes)
 *   - MCP discovery hints (mcpDiscovery)
 *
 * The daemon's /api/agents endpoint walks this list, resolves each binary
 * on PATH, probes --version and --help, fetches the model list, and returns
 * the assembled metadata to the UI. /api/chat uses getAgentDef() to look up
 * the spawn contract at run time.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  createCommandInvocation,
  wellKnownUserToolchainBins,
} from '@open-design/platform';
import { detectAcpModels } from '../acp.js';
import { parsePiModels } from '../pi-rpc.js';

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function execAgentFile(command: string, args: string[], options: Record<string, unknown> = {}) {
  const invocation = createCommandInvocation({
    command,
    args,
    env: options.env,
  });
  return execFileP(invocation.command, invocation.args, {
    ...options,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string;
  label: string;
}

export interface ReasoningOption {
  id: string;
  label: string;
}

export interface ListModelsSpec {
  args: string[];
  parse: (stdout: string) => ModelOption[] | null;
  timeoutMs?: number;
}

export interface AgentDef {
  id: string;
  name: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  helpArgs?: string[];
  capabilityFlags?: Record<string, string>;
  fallbackModels: ModelOption[];
  reasoningOptions?: ReasoningOption[];
  listModels?: ListModelsSpec;
  fetchModels?: (resolvedBin: string, env: Record<string, string>) => Promise<ModelOption[] | null>;
  buildArgs: (
    prompt: string,
    imagePaths: string[],
    extraAllowedDirs: string[],
    options: { model?: string; reasoning?: string },
    runtimeContext: { cwd?: string },
  ) => string[];
  promptViaStdin?: boolean;
  streamFormat: StreamFormat;
  eventParser?: string;
  env?: Record<string, string>;
  maxPromptArgBytes?: number;
  supportsImagePaths?: boolean;
  mcpDiscovery?: string;
}

export type StreamFormat =
  | 'claude-stream-json'
  | 'qoder-stream-json'
  | 'copilot-stream-json'
  | 'json-event-stream'
  | 'acp-json-rpc'
  | 'pi-rpc'
  | 'plain';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_OPTION: ModelOption = { id: 'default', label: 'Default (CLI config)' };

export const AGENT_BIN_ENV_KEYS = new Map<string, string>([
  ['claude', 'CLAUDE_BIN'],
  ['codex', 'CODEX_BIN'],
  ['copilot', 'COPILOT_BIN'],
  ['cursor-agent', 'CURSOR_AGENT_BIN'],
  ['deepseek', 'DEEPSEEK_BIN'],
  ['devin', 'DEVIN_BIN'],
  ['gemini', 'GEMINI_BIN'],
  ['hermes', 'HERMES_BIN'],
  ['kimi', 'KIMI_BIN'],
  ['kiro', 'KIRO_BIN'],
  ['kilo', 'KILO_BIN'],
  ['opencode', 'OPENCODE_BIN'],
  ['pi', 'PI_BIN'],
  ['qoder', 'QODER_BIN'],
  ['qwen', 'QWEN_BIN'],
  ['vibe', 'VIBE_BIN'],
]);

// ---------------------------------------------------------------------------
// Model-list parsing helpers
// ---------------------------------------------------------------------------

/** Parse one-id-per-line stdout from `<cli> models` and prepend the synthetic default option. */
function parseLineSeparatedModels(stdout: string): ModelOption[] {
  const ids = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const seen = new Set<string>();
  const out: ModelOption[] = [DEFAULT_MODEL_OPTION];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }
  return out;
}

/** Map a user-picked reasoning effort to one the chosen Codex model will accept. */
function clampCodexReasoning(modelId: string | undefined, effort: string): string {
  if (!effort) return effort;
  const raw = String(modelId ?? '').trim();
  const id = raw.includes('/') ? raw.split('/').pop()! : raw;
  const isGpt5LateFamily =
    !id ||
    id === 'default' ||
    id.startsWith('gpt-5.2') ||
    id.startsWith('gpt-5.3') ||
    id.startsWith('gpt-5.4') ||
    id.startsWith('gpt-5.5');
  if (isGpt5LateFamily && effort === 'minimal') return 'low';
  if (id === 'gpt-5.1' && effort === 'xhigh') return 'high';
  if (id === 'gpt-5.1-codex-mini') {
    return effort === 'high' || effort === 'xhigh' ? 'high' : 'medium';
  }
  return effort;
}

// ---------------------------------------------------------------------------
// Per-agent capability cache (populated by probe in detect.ts)
// ---------------------------------------------------------------------------

/** Capability flags detected at probe time (per agent id). */
export const agentCapabilities = new Map<string, Record<string, boolean>>();

// ---------------------------------------------------------------------------
// AGENT_DEFS — the canonical adapter table
// ---------------------------------------------------------------------------

export const AGENT_DEFS: AgentDef[] = [
  // ── Claude Code ──────────────────────────────────────────────────────────
  {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    fallbackBins: ['openclaude'],
    versionArgs: ['--version'],
    helpArgs: ['-p', '--help'],
    capabilityFlags: {
      '--include-partial-messages': 'partialMessages',
      '--add-dir': 'addDir',
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'sonnet', label: 'Sonnet (alias)' },
      { id: 'opus', label: 'Opus (alias)' },
      { id: 'haiku', label: 'Haiku (alias)' },
      { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
      { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
    ],
    buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], options = {}) => {
      const caps = agentCapabilities.get('claude') || {};
      const args = ['-p', '--output-format', 'stream-json', '--verbose'];
      if (caps.partialMessages) {
        args.push('--include-partial-messages');
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      if (dirs.length > 0 && caps.addDir !== false) {
        args.push('--add-dir', ...dirs);
      }
      args.push('--permission-mode', 'bypassPermissions');
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'claude-stream-json',
  },

  // ── Codex CLI ────────────────────────────────────────────────────────────
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gpt-5.5', label: 'gpt-5.5' },
      { id: 'gpt-5.4', label: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      { id: 'gpt-5.1', label: 'gpt-5.1' },
      { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
      { id: 'gpt-5-codex', label: 'gpt-5-codex' },
      { id: 'gpt-5', label: 'gpt-5' },
      { id: 'o3', label: 'o3' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'none', label: 'None' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
    ],
    buildArgs: (
      _prompt,
      _imagePaths,
      extraAllowedDirs = [],
      options = {},
      runtimeContext = {},
    ) => {
      const args = [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=true',
      ];
      if (process.env.OD_CODEX_DISABLE_PLUGINS === '1') {
        args.push('--disable', 'plugins');
      }
      if (runtimeContext.cwd) {
        args.push('-C', runtimeContext.cwd);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      for (const d of dirs) {
        args.push('--add-dir', d);
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      if (options.reasoning && options.reasoning !== 'default') {
        const effort = clampCodexReasoning(options.model, options.reasoning);
        args.push('-c', `model_reasoning_effort="${effort}"`);
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'codex',
  },

  // ── Devin for Terminal ───────────────────────────────────────────────────
  {
    id: 'devin',
    name: 'Devin for Terminal',
    bin: 'devin',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
        bin: resolvedBin,
        args: [
          '--permission-mode',
          'dangerous',
          '--respect-workspace-trust',
          'false',
          'acp',
        ],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'adaptive', label: 'adaptive' },
      { id: 'swe', label: 'swe' },
      { id: 'opus', label: 'opus' },
      { id: 'sonnet', label: 'sonnet' },
      { id: 'codex', label: 'codex' },
      { id: 'gpt', label: 'gpt' },
      { id: 'gemini', label: 'gemini' },
    ],
    buildArgs: () => [
      '--permission-mode',
      'dangerous',
      '--respect-workspace-trust',
      'false',
      'acp',
    ],
    streamFormat: 'acp-json-rpc',
  },

  // ── Gemini CLI ───────────────────────────────────────────────────────────
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bin: 'gemini',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview' },
      { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
    ],
    env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
    buildArgs: (_prompt, _imagePaths, _extra, options = {}) => {
      const args = ['--output-format', 'stream-json', '--yolo'];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'gemini',
  },

  // ── OpenCode ─────────────────────────────────────────────────────────────
  {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode',
    versionArgs: ['--version'],
    listModels: {
      args: ['models'],
      parse: parseLineSeparatedModels,
      timeoutMs: 8000,
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
      { id: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro' },
    ],
    buildArgs: (_prompt, _imagePaths, _extra, options = {}) => {
      const args = [
        'run',
        '--format',
        'json',
        '--dangerously-skip-permissions',
      ];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      args.push('-');
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'opencode',
  },

  // ── Hermes ───────────────────────────────────────────────────────────────
  {
    id: 'hermes',
    name: 'Hermes',
    bin: 'hermes',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
        bin: resolvedBin,
        args: ['acp', '--accept-hooks'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'openai-codex:gpt-5.5', label: 'gpt-5.5 (openai-codex:gpt-5.5)' },
      { id: 'openai-codex:gpt-5.4', label: 'gpt-5.4 (openai-codex:gpt-5.4)' },
      { id: 'openai-codex:gpt-5.4-mini', label: 'gpt-5.4-mini (openai-codex:gpt-5.4-mini)' },
    ],
    buildArgs: () => ['acp', '--accept-hooks'],
    streamFormat: 'acp-json-rpc',
    mcpDiscovery: 'mature-acp',
  },

  // ── Kimi CLI ─────────────────────────────────────────────────────────────
  {
    id: 'kimi',
    name: 'Kimi CLI',
    bin: 'kimi',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
        bin: resolvedBin,
        args: ['acp'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview' },
      { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
      { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k' },
    ],
    buildArgs: () => ['acp'],
    streamFormat: 'acp-json-rpc',
    mcpDiscovery: 'mature-acp',
  },

  // ── Cursor Agent ─────────────────────────────────────────────────────────
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor-agent',
    versionArgs: ['--version'],
    listModels: {
      args: ['models'],
      timeoutMs: 5000,
      parse: (stdout) => {
        const trimmed = String(stdout || '').trim();
        if (!trimmed || /no models available/i.test(trimmed)) return null;
        return parseLineSeparatedModels(trimmed);
      },
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'auto', label: 'auto' },
      { id: 'sonnet-4', label: 'sonnet-4' },
      { id: 'sonnet-4-thinking', label: 'sonnet-4-thinking' },
      { id: 'gpt-5', label: 'gpt-5' },
    ],
    buildArgs: (
      _prompt,
      _imagePaths,
      _extra,
      options = {},
      runtimeContext = {},
    ) => {
      const args = [];
      args.push(
        '--print',
        '--output-format',
        'stream-json',
        '--stream-partial-output',
        '--force',
        '--trust',
      );
      if (runtimeContext.cwd) {
        args.push('--workspace', runtimeContext.cwd);
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'cursor-agent',
  },

  // ── Qwen Code ────────────────────────────────────────────────────────────
  {
    id: 'qwen',
    name: 'Qwen Code',
    bin: 'qwen',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'qwen3-coder-plus', label: 'qwen3-coder-plus' },
      { id: 'qwen3-coder-flash', label: 'qwen3-coder-flash' },
    ],
    buildArgs: (_prompt, _imagePaths, _extra, options = {}) => {
      const args = ['--yolo'];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      args.push('-');
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'plain',
  },

  // ── Qoder CLI ────────────────────────────────────────────────────────────
  {
    id: 'qoder',
    name: 'Qoder CLI',
    bin: 'qodercli',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'lite', label: 'Lite' },
      { id: 'efficient', label: 'Efficient' },
      { id: 'auto', label: 'Auto' },
      { id: 'performance', label: 'Performance' },
      { id: 'ultimate', label: 'Ultimate' },
    ],
    buildArgs: (
      _prompt,
      imagePaths,
      extraAllowedDirs = [],
      options = {},
      runtimeContext = {},
    ) => {
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--yolo',
      ];
      if (runtimeContext.cwd) {
        args.push('-w', runtimeContext.cwd);
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && path.isAbsolute(d),
      );
      const attachments = (imagePaths || []).filter(
        (p) => typeof p === 'string' && path.isAbsolute(p),
      );
      for (const d of dirs) args.push('--add-dir', d);
      for (const p of attachments) args.push('--attachment', p);
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'qoder-stream-json',
  },

  // ── GitHub Copilot CLI ───────────────────────────────────────────────────
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    bin: 'copilot',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
    ],
    buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], options = {}) => {
      const args = [
        '--allow-all-tools',
        '--output-format',
        'json',
      ];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && d.length > 0,
      );
      for (const d of dirs) args.push('--add-dir', d);
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'copilot-stream-json',
  },

  // ── Pi ───────────────────────────────────────────────────────────────────
  {
    id: 'pi',
    name: 'Pi',
    bin: 'pi',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) => {
      try {
        const { stderr } = await execAgentFile(resolvedBin, ['--list-models'], {
          env,
          timeout: 20_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        const parsed = parsePiModels(stderr);
        if (!parsed || parsed.length === 0) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (anthropic)' },
      { id: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5 (anthropic)' },
      { id: 'openai/gpt-5', label: 'GPT-5 (openai)' },
      { id: 'openai/o4-mini', label: 'o4-mini (openai)' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (google)' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (google)' },
    ],
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'off', label: 'Off' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
    ],
    buildArgs: (
      _prompt,
      _imagePaths,
      extraAllowedDirs = [],
      options = {},
      _runtimeContext = {},
    ) => {
      const args = ['--mode', 'rpc'];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      if (options.reasoning && options.reasoning !== 'default') {
        args.push('--thinking', options.reasoning);
      }
      const dirs = (extraAllowedDirs || []).filter(
        (d) => typeof d === 'string' && path.isAbsolute(d),
      );
      for (const d of dirs) {
        args.push('--append-system-prompt', d);
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'pi-rpc',
    supportsImagePaths: true,
  },

  // ── Kiro CLI ─────────────────────────────────────────────────────────────
  {
    id: 'kiro',
    name: 'Kiro CLI',
    bin: 'kiro-cli',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
        bin: resolvedBin,
        args: ['acp'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: () => ['acp'],
    streamFormat: 'acp-json-rpc',
  },

  // ── Kilo ─────────────────────────────────────────────────────────────────
  {
    id: 'kilo',
    name: 'Kilo',
    bin: 'kilo',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
        bin: resolvedBin,
        args: ['acp'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: () => ['acp'],
    streamFormat: 'acp-json-rpc',
  },

  // ── Mistral Vibe CLI ─────────────────────────────────────────────────────
  {
    id: 'vibe',
    name: 'Mistral Vibe CLI',
    bin: 'vibe-acp',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
        bin: resolvedBin,
        args: [],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: () => [],
    streamFormat: 'acp-json-rpc',
  },

  // ── DeepSeek TUI ─────────────────────────────────────────────────────────
  {
    id: 'deepseek',
    name: 'DeepSeek TUI',
    bin: 'deepseek',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
    ],
    buildArgs: (prompt, _imagePaths, _extra, options = {}) => {
      const args = ['exec', '--auto'];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      args.push(prompt);
      return args;
    },
    maxPromptArgBytes: 30_000,
    streamFormat: 'plain',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Find an agent definition by id. Returns null when not found. */
export function getAgentDef(id: string): AgentDef | null {
  return AGENT_DEFS.find((a) => a.id === id) || null;
}
