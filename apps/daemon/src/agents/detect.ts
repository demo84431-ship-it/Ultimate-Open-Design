// @ts-nocheck
/**
 * Agent PATH scanning, binary resolution, and runtime detection.
 *
 * This module owns:
 *   - resolveOnPath() — find a binary on the user's PATH + toolchain dirs
 *   - resolveAgentExecutable() — walk fallbackBins + env overrides
 *   - resolveAgentBin() — public entry point used by the chat handler
 *   - spawnEnvForAgent() — build the child-process env (strips ANTHROPIC_API_KEY for Claude)
 *   - detectAgents() — probe every AGENT_DEF and return availability + models
 *   - model validation (isKnownModel, sanitizeCustomModel, rememberLiveModels)
 *   - argv budget guards (checkPromptArgvBudget, checkWindowsCmdShimCommandLineBudget,
 *     checkWindowsDirectExeCommandLineBudget)
 *   - buildLiveArtifactsMcpServersForAgent() — MCP server config for mature ACP agents
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter } from 'node:path';
import path from 'node:path';
import { homedir } from 'node:os';
import {
  createCommandInvocation,
  wellKnownUserToolchainBins,
} from '@open-design/platform';
import {
  AGENT_DEFS,
  AGENT_BIN_ENV_KEYS,
  agentCapabilities,
  getAgentDef,
} from './adapters.js';
import type { AgentDef, ModelOption } from './adapters.js';
import { expandHomePrefix } from '../home-expansion.js';

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

function expandHomePath(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

function expandConfiguredEnv(configuredEnv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!configuredEnv || typeof configuredEnv !== 'object') return out;
  for (const [key, value] of Object.entries(configuredEnv)) {
    if (typeof value !== 'string') continue;
    out[key] = expandHomePath(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Toolchain / PATH resolution
// ---------------------------------------------------------------------------

const TOOLCHAIN_DIR_CACHE_TTL_MS = 5000;
let cachedToolchainHome: string | null = null;
let cachedToolchainDirs: string[] | null = null;
let cachedToolchainDirsAt = 0;

function userToolchainDirs(): string[] {
  const homeOverride = process.env.OD_AGENT_HOME;
  const home = homeOverride || homedir();
  const now = Date.now();
  if (
    cachedToolchainHome === home &&
    cachedToolchainDirs &&
    now - cachedToolchainDirsAt < TOOLCHAIN_DIR_CACHE_TTL_MS
  ) {
    return cachedToolchainDirs;
  }
  cachedToolchainHome = home;
  cachedToolchainDirsAt = now;
  cachedToolchainDirs = wellKnownUserToolchainBins({
    home,
    includeSystemBins: process.platform !== 'win32' && !homeOverride,
    env: homeOverride ? {} : process.env,
  });
  return cachedToolchainDirs;
}

function resolvePathDirs(): string[] {
  const seen = new Set<string>();
  const dirs = [
    ...(process.env.PATH || '').split(delimiter),
    ...userToolchainDirs(),
  ];
  return dirs.filter((dir) => {
    if (!dir || seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

/** Resolve a binary name to its absolute path on PATH + toolchain dirs. */
export function resolveOnPath(bin: string): string | null {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];
  const dirs = resolvePathDirs();
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (full && existsSync(full)) return full;
    }
  }
  return null;
}

function looksExecutableOnWindows(filePath: string): boolean {
  const ext = path.extname(filePath).trim().toUpperCase();
  if (!ext) return false;
  const executableExts = (process.env.PATHEXT || '.EXE;.CMD;.BAT')
    .split(';')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return executableExts.includes(ext);
}

// ---------------------------------------------------------------------------
// Agent binary resolution
// ---------------------------------------------------------------------------

function configuredExecutableOverride(
  def: AgentDef,
  configuredEnv: Record<string, string> = {},
): string | null {
  const envKey = AGENT_BIN_ENV_KEYS.get(def?.id);
  if (!envKey) return null;
  const raw = configuredEnv?.[envKey];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const expanded = expandHomePath(raw.trim());
  if (!path.isAbsolute(expanded)) return null;
  try {
    if (!statSync(expanded).isFile()) return null;
    if (process.platform === 'win32') {
      if (!looksExecutableOnWindows(expanded)) return null;
    } else {
      accessSync(expanded, constants.X_OK);
    }
    return expanded;
  } catch {
    return null;
  }
}

/** Resolve the first available binary for an agent definition. */
export function resolveAgentExecutable(
  def: AgentDef,
  configuredEnv: Record<string, string> = {},
): string | null {
  if (!def?.bin) return null;
  const configured = configuredExecutableOverride(def, configuredEnv);
  if (configured) return configured;
  const candidates = [
    def.bin,
    ...(Array.isArray(def.fallbackBins) ? def.fallbackBins : []),
  ];
  for (const bin of candidates) {
    const resolved = resolveOnPath(bin);
    if (resolved) return resolved;
  }
  return null;
}

/** Resolve the absolute path of an agent's binary — public entry point for /api/chat. */
export function resolveAgentBin(
  id: string,
  configuredEnv: Record<string, string> = {},
): string | null {
  const def = getAgentDef(id);
  if (!def?.bin) return null;
  return resolveAgentExecutable(def, configuredEnv);
}

// ---------------------------------------------------------------------------
// Spawn environment
// ---------------------------------------------------------------------------

/**
 * Build the env passed to spawn() for a given agent adapter.
 *
 * The claude adapter strips ANTHROPIC_API_KEY so Claude Code's own auth
 * resolution wins instead of silently falling back to API-key billing.
 * When ANTHROPIC_BASE_URL is set the user is intentionally routing to a
 * custom endpoint, so we preserve the key.
 */
export function spawnEnvForAgent(
  agentId: string,
  baseEnv: Record<string, string>,
  configuredEnv: Record<string, string> = {},
): Record<string, string> {
  const env = { ...baseEnv, ...expandConfiguredEnv(configuredEnv) };
  if (agentId !== 'claude') return env;
  const hasCustomBaseUrl = Object.keys(env).some(
    (k) =>
      k.toUpperCase() === 'ANTHROPIC_BASE_URL' &&
      typeof env[k] === 'string' &&
      env[k].trim() !== '',
  );
  if (hasCustomBaseUrl) return env;
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ANTHROPIC_API_KEY') delete env[key];
  }
  return env;
}

// ---------------------------------------------------------------------------
// Model list fetching
// ---------------------------------------------------------------------------

async function fetchModels(
  def: AgentDef,
  resolvedBin: string,
  env: Record<string, string>,
): Promise<ModelOption[]> {
  if (typeof def.fetchModels === 'function') {
    try {
      const parsed = await def.fetchModels(resolvedBin, env);
      if (!parsed || parsed.length === 0) return def.fallbackModels;
      return parsed;
    } catch {
      return def.fallbackModels;
    }
  }
  if (!def.listModels) return def.fallbackModels;
  try {
    const { stdout } = await execAgentFile(resolvedBin, def.listModels.args, {
      env,
      timeout: def.listModels.timeoutMs ?? 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = def.listModels.parse(stdout);
    if (!parsed || parsed.length === 0) return def.fallbackModels;
    return parsed;
  } catch {
    return def.fallbackModels;
  }
}

// ---------------------------------------------------------------------------
// Probe + detect
// ---------------------------------------------------------------------------

function stripFns(def: AgentDef): Omit<AgentDef, 'buildArgs' | 'listModels' | 'fetchModels' | 'fallbackModels' | 'helpArgs' | 'capabilityFlags' | 'fallbackBins' | 'maxPromptArgBytes' | 'env'> {
  const {
    buildArgs,
    listModels,
    fetchModels,
    fallbackModels,
    helpArgs,
    capabilityFlags,
    fallbackBins,
    maxPromptArgBytes,
    env,
    ...rest
  } = def;
  return rest;
}

async function probe(def: AgentDef, configuredEnv: Record<string, string> = {}) {
  const resolved = resolveAgentExecutable(def, configuredEnv);
  if (!resolved) {
    return {
      ...stripFns(def),
      models: def.fallbackModels ?? [{ id: 'default', label: 'Default (CLI config)' }],
      available: false,
    };
  }
  const probeEnv = spawnEnvForAgent(
    def.id,
    {
      ...process.env,
      ...(def.env || {}),
    },
    configuredEnv,
  );
  let version: string | null = null;
  try {
    const { stdout } = await execAgentFile(resolved, def.versionArgs, {
      env: probeEnv,
      timeout: 3000,
    });
    version = stdout.trim().split('\n')[0];
  } catch {
    // binary exists but --version failed; still mark available
  }
  // Probe --help and record which flags the installed CLI advertises.
  if (def.helpArgs && def.capabilityFlags) {
    const caps: Record<string, boolean> = {};
    try {
      const { stdout } = await execAgentFile(resolved, def.helpArgs, {
        env: probeEnv,
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
      });
      for (const [flag, key] of Object.entries(def.capabilityFlags)) {
        caps[key] = stdout.includes(flag);
      }
    } catch {
      // If --help fails, leave caps empty.
    }
    agentCapabilities.set(def.id, caps);
  }
  const models = await fetchModels(def, resolved, probeEnv);
  return {
    ...stripFns(def),
    models,
    available: true,
    path: resolved,
    version,
  };
}

/** Probe every agent definition and return availability + models. */
export async function detectAgents(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
) {
  const results = await Promise.all(
    AGENT_DEFS.map((def) => probe(def, configuredEnvByAgent?.[def.id] ?? {})),
  );
  for (const agent of results) {
    rememberLiveModels(agent.id, agent.models);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Model validation
// ---------------------------------------------------------------------------

const liveModelCache = new Map<string, Set<string>>();

export function rememberLiveModels(agentId: string, models: ModelOption[]) {
  if (!Array.isArray(models)) return;
  liveModelCache.set(
    agentId,
    new Set(
      models.map((m) => m && m.id).filter((id) => typeof id === 'string'),
    ),
  );
}

export function isKnownModel(def: AgentDef, modelId: string): boolean {
  if (!modelId) return false;
  const live = liveModelCache.get(def.id);
  if (live && live.has(modelId)) return true;
  if (Array.isArray(def.fallbackModels)) {
    return def.fallbackModels.some((m) => m.id === modelId);
  }
  return false;
}

export function sanitizeCustomModel(id: string): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(trimmed)) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// MCP live-artifact servers for mature ACP agents
// ---------------------------------------------------------------------------

export function buildLiveArtifactsMcpServersForAgent(
  def: AgentDef,
  { enabled = true, command = 'od', argsPrefix = [] }: { enabled?: boolean; command?: string; argsPrefix?: string[] } = {},
) {
  if (!enabled || def?.mcpDiscovery !== 'mature-acp') return [];
  return [
    {
      name: 'open-design-live-artifacts',
      command,
      args: [...argsPrefix, 'mcp', 'live-artifacts'],
      env: [],
    },
  ];
}

// ---------------------------------------------------------------------------
// Prompt argv budget guards
// ---------------------------------------------------------------------------

export function checkPromptArgvBudget(
  def: AgentDef,
  composed: string,
): { code: string; message: string; bytes: number; limit: number } | null {
  if (!def || typeof def.maxPromptArgBytes !== 'number') return null;
  const bytes = Buffer.byteLength(
    typeof composed === 'string' ? composed : '',
    'utf8',
  );
  if (bytes <= def.maxPromptArgBytes) return null;
  return {
    code: 'AGENT_PROMPT_TOO_LARGE',
    message:
      `${def.name} requires the prompt as a command-line argument and this run's composed prompt exceeds the safe size (${bytes} > ${def.maxPromptArgBytes} bytes). ` +
      'Reduce the selected skills/design-system context, shorten the conversation, or pick an adapter with stdin support.',
    bytes,
    limit: def.maxPromptArgBytes,
  };
}

function quoteForWindowsCmdShim(value: string): string {
  const str = String(value ?? '');
  if (!/[\s"&<>|^%]/.test(str)) return str;
  const escaped = str.replace(/"/g, '""').replace(/%/g, '"^%"');
  return `"${escaped}"`;
}

const WINDOWS_CREATE_PROCESS_LIMIT = 32_767;
const WINDOWS_CREATE_PROCESS_HEADROOM = 256;

export function checkWindowsCmdShimCommandLineBudget(
  def: AgentDef,
  resolvedBin: string,
  args: string[],
): { code: string; message: string; commandLineLength: number; limit: number } | null {
  if (!def || typeof def.maxPromptArgBytes !== 'number') return null;
  if (typeof resolvedBin !== 'string' || !/\.(bat|cmd)$/i.test(resolvedBin))
    return null;
  const argList = Array.isArray(args) ? args : [];
  const inner = [resolvedBin, ...argList].map(quoteForWindowsCmdShim).join(' ');
  const commandLineLength = 'cmd.exe /d /s /c '.length + inner.length + 2;
  const safeLimit = WINDOWS_CREATE_PROCESS_LIMIT - WINDOWS_CREATE_PROCESS_HEADROOM;
  if (commandLineLength <= safeLimit) return null;
  return {
    code: 'AGENT_PROMPT_TOO_LARGE',
    message:
      `${def.name} on Windows runs through a .cmd shim and this run's prompt would expand past the CreateProcess command-line limit ` +
      `after cmd.exe quote-doubling (${commandLineLength} > ${safeLimit} chars). ` +
      'Reduce quote-heavy content in the selected skills/design-system context, shorten the conversation, or pick an adapter with stdin support.',
    commandLineLength,
    limit: safeLimit,
  };
}

function quoteForWindowsDirectExe(value: string): string {
  const str = String(value ?? '');
  if (str.length === 0) return '""';
  if (!/[\s"]/.test(str)) return str;
  if (!/[\\"]/.test(str)) return `"${str}"`;
  let result = '"';
  let backslashes = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\') {
      backslashes++;
    } else if (ch === '"') {
      result += '\\'.repeat(2 * backslashes + 1) + '"';
      backslashes = 0;
    } else {
      result += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
  }
  result += '\\'.repeat(2 * backslashes) + '"';
  return result;
}

function looksLikeWindowsPath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false;
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export function checkWindowsDirectExeCommandLineBudget(
  def: AgentDef,
  resolvedBin: string,
  args: string[],
): { code: string; message: string; commandLineLength: number; limit: number } | null {
  if (!def || typeof def.maxPromptArgBytes !== 'number') return null;
  if (typeof resolvedBin !== 'string' || resolvedBin.length === 0) return null;
  if (/\.(bat|cmd)$/i.test(resolvedBin)) return null;
  if (!looksLikeWindowsPath(resolvedBin)) return null;
  const argList = Array.isArray(args) ? args : [];
  const commandLineLength = [resolvedBin, ...argList]
    .map(quoteForWindowsDirectExe)
    .join(' ').length;
  const safeLimit = WINDOWS_CREATE_PROCESS_LIMIT - WINDOWS_CREATE_PROCESS_HEADROOM;
  if (commandLineLength <= safeLimit) return null;
  return {
    code: 'AGENT_PROMPT_TOO_LARGE',
    message:
      `${def.name} on Windows builds a CreateProcess command line and this run's prompt would expand past the limit ` +
      `after libuv quote-escaping (${commandLineLength} > ${safeLimit} chars). ` +
      'Reduce quote-heavy content in the selected skills/design-system context, shorten the conversation, or pick an adapter with stdin support.',
    commandLineLength,
    limit: safeLimit,
  };
}
