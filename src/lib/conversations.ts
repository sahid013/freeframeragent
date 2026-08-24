import type {ApiMessage} from '@/lib/agentLoop';

/**
 * In-memory transcript per (project, session), including tool calls and their
 * results.
 *
 * Without this the loop rebuilt its message list from visible text only, so a
 * follow-up like "now make it bolder" arrived with no record of the ten steps
 * that located the node last time — and the agent re-derived it from scratch.
 *
 * Held on globalThis so Next's dev hot-reload doesn't wipe mid-conversation.
 */

type Store = Map<string, ApiMessage[]>;

const globalRef = globalThis as typeof globalThis & {__framerConversations?: Store};
const store: Store = (globalRef.__framerConversations ??= new Map());

function key(projectId: string, sessionId: string): string {
  return `${projectId}::${sessionId}`;
}

export function loadConversation(projectId: string, sessionId: string): ApiMessage[] {
  return store.get(key(projectId, sessionId)) ?? [];
}

export function saveConversation(
  projectId: string,
  sessionId: string,
  messages: ApiMessage[],
): void {
  store.set(key(projectId, sessionId), messages);
}

export function resetConversation(projectId: string, sessionId: string): void {
  store.delete(key(projectId, sessionId));
}

/** Rough token proxy — good enough for deciding what to drop. */
function weigh(message: ApiMessage): number {
  return JSON.stringify(message).length;
}

const BUDGET_CHARS = 400_000;

/**
 * Trim old turns while keeping the transcript valid.
 *
 * Every `tool` message must still follow the assistant message carrying its
 * matching tool_call id, so we only ever cut at a user-message boundary —
 * dropping a whole exchange rather than slicing one in half.
 */
export function trimConversation(messages: ApiMessage[]): ApiMessage[] {
  let total = messages.reduce((sum, m) => sum + weigh(m), 0);
  if (total <= BUDGET_CHARS) return messages;

  // Index 0 is the system prompt and always stays.
  const [system, ...rest] = messages;
  let start = 0;

  while (total > BUDGET_CHARS && start < rest.length - 1) {
    // Cut forward to the next user message, dropping a whole exchange at a time.
    let next = start + 1;
    while (next < rest.length && rest[next].role !== 'user') next += 1;
    if (next >= rest.length) break;

    for (let i = start; i < next; i++) total -= weigh(rest[i]);
    start = next;
  }

  return [system, ...rest.slice(start)];
}
