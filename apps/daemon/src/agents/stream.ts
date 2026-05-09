// @ts-nocheck
/**
 * Per-agent stream format routing and SSE event normalization.
 *
 * Each agent CLI emits stdout in a different format. This module routes
 * the child's stdout bytes to the correct parser and normalizes the
 * output into a common event shape consumed by the chat UI:
 *
 *   { type: string, ...payload }
 *
 * Supported stream formats:
 *   - 'claude-stream-json'   — Claude Code's line-delimited JSON
 *   - 'qoder-stream-json'    — Qoder CLI's line-delimited JSON
 *   - 'copilot-stream-json'  — GitHub Copilot CLI's line-delimited JSON
 *   - 'json-event-stream'    — OpenCode / Gemini / Cursor Agent / Codex JSON events
 *   - 'pi-rpc'               — Pi's JSON-RPC over stdio
 *   - 'acp-json-rpc'         — ACP agents (Hermes, Kimi, Devin, Kiro, Kilo, Vibe)
 *   - 'plain'                — raw text, forwarded chunk-by-chunk
 */

import type { ChildProcess } from 'node:child_process';
import type { StreamFormat } from './adapters.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export type EventSink = (event: StreamEvent) => void;

export interface StreamRouteParams {
  streamFormat: StreamFormat;
  eventParser?: string;
  child: ChildProcess;
  composed: string;
  effectiveCwd: string;
  safeImages: string[];
  safeModel?: string | null;
  mcpServers: Array<{ name: string; command: string; args: string[]; env: string[] }>;
  sendAgentEvent: EventSink;
  send: (event: string, data: unknown) => void;
  noteAgentActivity: () => void;
  supportsImagePaths?: boolean;
  uploadRoot: string;
}

export interface StreamRouteResult {
  acpSession: { abort?: () => void; hasFatalError?: () => boolean } | null;
  /** Whether this format tracks substantive output for the empty-output guard. */
  tracksSubstantiveOutput: boolean;
}

// ---------------------------------------------------------------------------
// Stream format router
// ---------------------------------------------------------------------------

/**
 * Route the child's stdout to the appropriate stream-format handler.
 *
 * For structured formats (claude-stream-json, qoder-stream-json,
 * copilot-stream-json, json-event-stream), we import the existing
 * handler modules and wire them up.
 *
 * For pi-rpc and acp-json-rpc, we delegate to their session managers.
 *
 * For plain format, we forward raw chunks as 'stdout' events.
 *
 * Returns an acpSession handle (for pi-rpc / acp-json-rpc) and whether
 * the format tracks substantive output.
 */
export function routeStreamByFormat(params: StreamRouteParams): StreamRouteResult {
  const {
    streamFormat,
    eventParser,
    child,
    composed,
    effectiveCwd,
    safeImages,
    safeModel,
    mcpServers,
    sendAgentEvent,
    send,
    noteAgentActivity,
    supportsImagePaths,
    uploadRoot,
  } = params;

  let acpSession: { abort?: () => void; hasFatalError?: () => boolean } | null = null;
  let tracksSubstantiveOutput = false;

  switch (streamFormat) {
    // ── Claude Code ──────────────────────────────────────────────────────
    case 'claude-stream-json': {
      // Lazy-import to avoid circular deps at module-eval time.
      const { createClaudeStreamHandler } = require('../claude-stream.js');
      const claude = createClaudeStreamHandler((ev: StreamEvent) => {
        noteAgentActivity();
        send('agent', ev);
      });
      child.stdout.on('data', (chunk: string) => claude.feed(chunk));
      child.on('close', () => claude.flush());
      break;
    }

    // ── Qoder CLI ────────────────────────────────────────────────────────
    case 'qoder-stream-json': {
      tracksSubstantiveOutput = true;
      const { createQoderStreamHandler } = require('../qoder-stream.js');
      const qoder = createQoderStreamHandler(sendAgentEvent);
      child.stdout.on('data', (chunk: string) => qoder.feed(chunk));
      child.on('close', () => qoder.flush());
      break;
    }

    // ── GitHub Copilot CLI ───────────────────────────────────────────────
    case 'copilot-stream-json': {
      const { createCopilotStreamHandler } = require('../copilot-stream.js');
      const copilot = createCopilotStreamHandler((ev: StreamEvent) => {
        noteAgentActivity();
        send('agent', ev);
      });
      child.stdout.on('data', (chunk: string) => copilot.feed(chunk));
      child.on('close', () => copilot.flush());
      break;
    }

    // ── Pi RPC ───────────────────────────────────────────────────────────
    case 'pi-rpc': {
      tracksSubstantiveOutput = true;
      const { attachPiRpcSession } = require('../pi-rpc.js');
      acpSession = attachPiRpcSession({
        child,
        prompt: composed,
        cwd: effectiveCwd,
        model: safeModel,
        send: (channel: string, payload: unknown) => {
          if (channel === 'agent') {
            sendAgentEvent(payload as StreamEvent);
          } else if (channel === 'error') {
            sendAgentEvent({
              type: 'error',
              message: (payload as { message?: string })?.message || 'Pi session error',
            });
          } else {
            noteAgentActivity();
            send(channel, payload);
          }
        },
        imagePaths: supportsImagePaths ? safeImages : [],
        uploadRoot,
      });
      break;
    }

    // ── ACP JSON-RPC ─────────────────────────────────────────────────────
    case 'acp-json-rpc': {
      const { attachAcpSession } = require('../acp.js');
      acpSession = attachAcpSession({
        child,
        prompt: composed,
        cwd: effectiveCwd,
        model: safeModel,
        mcpServers,
        send: (event: string, data: unknown) => {
          noteAgentActivity();
          send(event, data);
        },
      });
      break;
    }

    // ── JSON event stream (OpenCode / Gemini / Cursor / Codex) ───────────
    case 'json-event-stream': {
      tracksSubstantiveOutput = true;
      const { createJsonEventStreamHandler } = require('../json-event-stream.js');
      const handler = createJsonEventStreamHandler(
        eventParser || 'default',
        sendAgentEvent,
      );
      child.stdout.on('data', (chunk: string) => handler.feed(chunk));
      child.on('close', () => handler.flush());
      break;
    }

    // ── Plain text ───────────────────────────────────────────────────────
    case 'plain':
    default: {
      child.stdout.on('data', (chunk: string) => {
        noteAgentActivity();
        send('stdout', { chunk });
      });
      break;
    }
  }

  return { acpSession, tracksSubstantiveOutput };
}

// ---------------------------------------------------------------------------
// Event type classification
// ---------------------------------------------------------------------------

/** Event types that count as "the agent actually produced visible content." */
export const SUBSTANTIVE_AGENT_EVENT_TYPES = new Set([
  'text_delta',
  'thinking_delta',
  'tool_use',
  'tool_result',
  'artifact',
]);

/** Check if a stream event represents substantive user-visible output. */
export function isSubstantiveEvent(ev: StreamEvent): boolean {
  return Boolean(ev?.type && SUBSTANTIVE_AGENT_EVENT_TYPES.has(ev.type));
}

// ---------------------------------------------------------------------------
// SSE error payload factory
// ---------------------------------------------------------------------------

export function createSseErrorPayload(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { code, message, ...extra };
}

// ---------------------------------------------------------------------------
// Empty-output guard (used by the close handler in startChatRun)
// ---------------------------------------------------------------------------

export interface EmptyOutputGuardResult {
  shouldFail: boolean;
  errorPayload?: Record<string, unknown>;
}

/**
 * Determine whether a clean exit (code 0) should be treated as a failure
 * because the agent produced no visible output. This catches the "silent
 * empty completion" anti-pattern (e.g. issue #691).
 */
export function checkEmptyOutputGuard(params: {
  code: number | null;
  cancelRequested: boolean;
  tracksSubstantiveOutput: boolean;
  agentProducedOutput: boolean;
  agentStreamError: string | null;
}): EmptyOutputGuardResult {
  const { code, cancelRequested, tracksSubstantiveOutput, agentProducedOutput, agentStreamError } = params;

  if (code !== 0 || cancelRequested) return { shouldFail: false };
  if (agentStreamError) return { shouldFail: false }; // already handled
  if (!tracksSubstantiveOutput) return { shouldFail: false }; // not tracked
  if (agentProducedOutput) return { shouldFail: false }; // had output

  return {
    shouldFail: true,
    errorPayload: createSseErrorPayload(
      'AGENT_EXECUTION_FAILED',
      'Agent completed without producing any output. The model or provider may have returned an empty response — check the agent logs for upstream errors.',
      { retryable: true },
    ),
  };
}
