// @ts-nocheck
/**
 * Agent child-process spawning and lifecycle management.
 *
 * This module owns:
 *   - spawnAgentChild() — fork the agent CLI with the right args, env, and stdio
 *   - ChildProcess lifecycle hooks (error, close, stderr, stdin EPIPE)
 *   - Inactivity watchdog (stalled-process detection and forced shutdown)
 *   - Prompt delivery via stdin pipe
 *   - Tool-token grant/revocation integration
 *   - Per-agent runtime environment construction (OD_BIN, OD_DAEMON_URL, etc.)
 *
 * The actual SSE stream parsing (per-format handlers) lives in stream.ts;
 * this module wires the child's stdout to the appropriate handler.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createCommandInvocation } from '@open-design/platform';
import type { AgentDef, StreamFormat } from './adapters.js';
import { resolveAgentBin, spawnEnvForAgent } from './detect.js';
import { routeStreamByFormat } from './stream.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  /** The agent definition (from AGENT_DEFS). */
  def: AgentDef;
  /** The fully composed prompt string. */
  composed: string;
  /** Resolved working directory for the child process. */
  effectiveCwd: string;
  /** Per-agent configured env overrides (from app-config). */
  configuredAgentEnv: Record<string, string>;
  /** Runtime env vars (OD_BIN, OD_DAEMON_URL, tool-token, etc.). */
  odMediaEnv: Record<string, string>;
  /** Safe image paths (validated under UPLOAD_DIR). */
  safeImages: string[];
  /** Per-agent model + reasoning options. */
  agentOptions: { model?: string | null; reasoning?: string | null };
  /** MCP server configs for ACP agents. */
  mcpServers: Array<{ name: string; command: string; args: string[]; env: string[] }>;
  /** Callback to send SSE events to the client. */
  send: (event: string, data: unknown) => void;
  /** Inactivity timeout in milliseconds (0 = disabled). */
  inactivityTimeoutMs: number;
  /** Called when a substantive agent event is emitted. */
  onSubstantiveOutput?: () => void;
  /** Callback to revoke the tool token on child exit. */
  revokeToolToken: (reason: string) => void;
  /** Callback to unregister the chat-agent event sink. */
  unregisterChatAgentEventSink: () => void;
}

export interface SpawnResult {
  child: ChildProcess;
  acpSession: { abort?: () => void; hasFatalError?: () => boolean } | null;
  /** Call this to signal that the prompt has been written to stdin. */
  writePromptToStdin: boolean;
  /** Cleanup function to clear the inactivity watchdog. */
  cleanup: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Grace period before SIGTERM after inactivity, then SIGKILL after another grace. */
const INACTIVITY_KILL_GRACE_MS = 3_000;

/** Event types that count as "the agent actually produced visible content." */
const SUBSTANTIVE_AGENT_EVENT_TYPES = new Set([
  'text_delta',
  'thinking_delta',
  'tool_use',
  'tool_result',
  'artifact',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createSseErrorPayload(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return { code, message, ...extra };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Spawn an agent child process, wire up stream parsing, inactivity watchdog,
 * and lifecycle hooks. Returns the child handle and cleanup utilities.
 *
 * Callers are responsible for:
 *   1. Pre-flight budget checks (checkPromptArgvBudget etc.) BEFORE calling.
 *   2. Sending the 'start' SSE event BEFORE calling.
 *   3. Calling revokeToolToken / unregisterChatAgentEventSink on error paths
 *      that this function doesn't own (e.g. pre-spawn failures).
 */
export function spawnAgentChild(opts: SpawnOptions): SpawnResult | null {
  const {
    def,
    composed,
    effectiveCwd,
    configuredAgentEnv,
    odMediaEnv,
    safeImages,
    agentOptions,
    mcpServers,
    send,
    inactivityTimeoutMs,
    onSubstantiveOutput,
    revokeToolToken,
    unregisterChatAgentEventSink,
  } = opts;

  // Resolve the agent binary.
  const resolvedBin = resolveAgentBin(def.id, configuredAgentEnv);
  if (!resolvedBin) {
    revokeToolToken('child_exit');
    unregisterChatAgentEventSink();
    send('error', createSseErrorPayload(
      'AGENT_UNAVAILABLE',
      `Agent "${def.name}" (\`${def.bin}\`) is not installed or not on PATH. ` +
        'Install it and refresh the agent list (GET /api/agents) before retrying.',
      { retryable: true },
    ));
    return null;
  }

  // Build CLI arguments.
  const args = def.buildArgs(
    composed,
    safeImages,
    [],
    agentOptions,
    { cwd: effectiveCwd },
  );

  // Build the child-process environment.
  const env = {
    ...spawnEnvForAgent(
      def.id,
      {
        ...process.env,
        ...(def.env || {}),
      },
      configuredAgentEnv,
    ),
    ...odMediaEnv,
  };

  // Determine stdin mode.
  const stdinMode =
    def.promptViaStdin || def.streamFormat === 'acp-json-rpc'
      ? 'pipe'
      : 'ignore';

  // Spawn the child process.
  let child: ChildProcess;
  try {
    const invocation = createCommandInvocation({
      command: resolvedBin,
      args,
      env,
    });
    child = spawn(invocation.command, invocation.args, {
      env,
      stdio: [stdinMode, 'pipe', 'pipe'],
      cwd: effectiveCwd,
      shell: false,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
  } catch (err) {
    revokeToolToken('child_exit');
    unregisterChatAgentEventSink();
    send('error', createSseErrorPayload('AGENT_EXECUTION_FAILED', `spawn failed: ${err.message}`));
    return null;
  }

  // ── Inactivity watchdog ──────────────────────────────────────────────────
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const clearInactivityWatchdog = () => {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  };

  const scheduleForcedChildShutdown = () => {
    if (!child) return;
    setTimeout(() => {
      if (child && !child.killed) child.kill('SIGTERM');
    }, INACTIVITY_KILL_GRACE_MS).unref?.();
    setTimeout(() => {
      if (child && !child.killed) child.kill('SIGKILL');
    }, INACTIVITY_KILL_GRACE_MS * 2).unref?.();
  };

  const failForInactivity = () => {
    const msg =
      `Agent stalled without emitting any new output for ${Math.round(inactivityTimeoutMs / 1000)}s. ` +
      'The model or CLI likely hung while generating. Retry the turn or pick a different model.';
    clearInactivityWatchdog();
    send('error', createSseErrorPayload('AGENT_EXECUTION_FAILED', msg, { retryable: true }));
    if (acpSession?.abort) acpSession.abort();
    if (child && !child.killed) child.kill('SIGTERM');
    scheduleForcedChildShutdown();
  };

  const noteAgentActivity = () => {
    if (inactivityTimeoutMs <= 0) return;
    clearInactivityWatchdog();
    inactivityTimer = setTimeout(failForInactivity, inactivityTimeoutMs);
    inactivityTimer.unref?.();
  };

  // ── Agent event tracking ─────────────────────────────────────────────────
  let agentStreamError: string | null = null;
  let agentProducedOutput = false;

  const sendAgentEvent = (ev: Record<string, unknown>) => {
    if (ev?.type === 'error') {
      if (agentStreamError) return;
      agentStreamError = String(ev.message || 'Agent stream error');
      clearInactivityWatchdog();
      send('error', createSseErrorPayload('AGENT_EXECUTION_FAILED', agentStreamError, {
        details: ev.raw ? { raw: ev.raw } : undefined,
        retryable: false,
      }));
      return;
    }
    noteAgentActivity();
    if (ev?.type && SUBSTANTIVE_AGENT_EVENT_TYPES.has(ev.type)) {
      agentProducedOutput = true;
      onSubstantiveOutput?.();
    }
    send('agent', ev);
  };

  // ── Stdin prompt delivery ────────────────────────────────────────────────
  let writePromptToStdin = false;
  if (def.promptViaStdin && child.stdin && def.streamFormat !== 'pi-rpc') {
    child.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        send('error', createSseErrorPayload(
          'AGENT_EXECUTION_FAILED',
          `stdin: ${err.message}`,
        ));
      }
    });
    writePromptToStdin = true;
  }

  // ── Wire stdout → stream parser ──────────────────────────────────────────
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  // Reset watchdog on every raw stdout byte.
  child.stdout.on('data', () => noteAgentActivity());

  const acpSession = routeStreamByFormat({
    streamFormat: def.streamFormat ?? 'plain',
    eventParser: def.eventParser,
    child,
    composed,
    effectiveCwd,
    safeImages,
    safeModel: agentOptions.model,
    mcpServers,
    sendAgentEvent,
    send,
    noteAgentActivity,
    supportsImagePaths: def.supportsImagePaths,
    uploadRoot: '', // caller provides UPLOAD_DIR
  });

  // ── Stderr forwarding ────────────────────────────────────────────────────
  child.stderr.on('data', (chunk) => {
    noteAgentActivity();
    send('stderr', { chunk });
  });

  // ── Child error ──────────────────────────────────────────────────────────
  child.on('error', (err) => {
    clearInactivityWatchdog();
    revokeToolToken('child_exit');
    unregisterChatAgentEventSink();
    send('error', createSseErrorPayload('AGENT_EXECUTION_FAILED', err.message));
  });

  // ── Child close ──────────────────────────────────────────────────────────
  // NOTE: The caller (startChatRun) is expected to attach its own 'close'
  // handler that calls design.runs.finish(). We return the child so the
  // caller can wire that up. The close handler here handles common cleanup
  // that applies regardless of the run-lifecycle owner.
  child.on('close', (code, signal) => {
    clearInactivityWatchdog();
    revokeToolToken('child_exit');
    unregisterChatAgentEventSink();
  });

  return {
    child,
    acpSession,
    writePromptToStdin,
    cleanup: clearInactivityWatchdog,
  };
}

// ---------------------------------------------------------------------------
// Prompt composition helpers (extracted from startChatRun)
// ---------------------------------------------------------------------------

export interface ComposePromptInput {
  instructionPrompt: string;
  message: string;
  cwdHint: string;
  linkedDirsHint: string;
  attachmentHint: string;
  commentHint: string;
  safeImages: string[];
}

/** Compose the final prompt string from its constituent parts. */
export function composePrompt(input: ComposePromptInput): string {
  const {
    instructionPrompt,
    message,
    cwdHint,
    linkedDirsHint,
    attachmentHint,
    commentHint,
    safeImages,
  } = input;

  return [
    instructionPrompt
      ? `# Instructions (read first)\n\n${instructionPrompt}${cwdHint}${linkedDirsHint}\n\n---\n`
      : cwdHint
        ? `# Instructions${cwdHint}${linkedDirsHint}\n\n---\n`
        : linkedDirsHint
          ? `# Instructions${linkedDirsHint}\n\n---\n`
          : '',
    `# User request\n\n${message || '(No extra typed instruction.)'}${attachmentHint}${commentHint}`,
    safeImages.length
      ? `\n\n${safeImages.map((p) => `@${p}`).join(' ')}`
      : '',
  ].join('');
}

// ---------------------------------------------------------------------------
// Model + reasoning validation (extracted from startChatRun)
// ---------------------------------------------------------------------------

import { isKnownModel, sanitizeCustomModel } from './detect.js';

export function resolveSafeModel(
  model: string | undefined,
  def: AgentDef,
): string | null {
  if (typeof model !== 'string') return null;
  return isKnownModel(def, model) ? model : sanitizeCustomModel(model);
}

export function resolveSafeReasoning(
  reasoning: string | undefined,
  def: AgentDef,
): string | null {
  if (typeof reasoning !== 'string' || !Array.isArray(def.reasoningOptions))
    return null;
  return def.reasoningOptions.find((r) => r.id === reasoning)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Runtime environment construction
// ---------------------------------------------------------------------------

export interface AgentRuntimeEnvParams {
  baseEnv: Record<string, string>;
  daemonUrl: string;
  toolTokenGrant: { token?: string; expiresAt?: number } | null;
}

/**
 * Build the base environment variables that every spawned agent receives.
 * Includes OD_DAEMON_URL, tool-token info, and other runtime knobs.
 */
export function createAgentRuntimeEnv(
  baseEnv: Record<string, string>,
  daemonUrl: string,
  toolTokenGrant: { token?: string; expiresAt?: number } | null,
): Record<string, string> {
  const env: Record<string, string> = { ...baseEnv };
  env.OD_DAEMON_URL = daemonUrl;
  if (toolTokenGrant?.token) {
    env.OD_TOOL_TOKEN = toolTokenGrant.token;
  }
  return env;
}
