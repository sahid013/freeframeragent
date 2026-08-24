'use client';

import {useCallback, useRef, useState} from 'react';

export type ToolCallItem = {
  key: string;
  name: string;
  target?: string;
  status: 'running' | 'complete' | 'error';
  resultDetail?: string;
  errorMessage?: string;
};

export type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** What the model actually receives — the prompt plus any attached layer. */
  apiText?: string;
  calls: ToolCallItem[];
  notes: string[];
  error?: string;
};

export type AttachedLayer = {
  id: string;
  name: string;
  type: string;
  snippet: string;
};

let counter = 0;
const nextId = () => `t${++counter}-${Date.now().toString(36)}`;

type SendOptions = {
  projectId: string;
  sessionId: string;
  model: string;
  layer?: AttachedLayer | null;
};

/**
 * Frame the picked layer for the model: what it is, where it is, and its
 * serialized form, so the agent doesn't have to search the tree for it.
 */
function withLayer(text: string, layer: AttachedLayer | null | undefined): string {
  if (!layer) return text;

  return [
    '<selected-layer>',
    'The user picked this layer in the element picker. Make the change here unless they say otherwise.',
    `id: ${layer.id}`,
    `name: ${layer.name}`,
    `type: ${layer.type}`,
    'serialized:',
    layer.snippet,
    '</selected-layer>',
    '',
    text,
  ].join('\n');
}

export function useFramerAgent() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /** Set by clear(); consumed by the next send so the server drops its transcript. */
  const resetRef = useRef(false);

  /** Synchronous mirror — a setState updater can't be read at call time. */
  const turnsRef = useRef<Turn[]>([]);

  const update = useCallback((fn: (prev: Turn[]) => Turn[]) => {
    turnsRef.current = fn(turnsRef.current);
    setTurns(turnsRef.current);
  }, []);

  const patchTurn = useCallback(
    (id: string, fn: (turn: Turn) => Turn) => {
      update((prev) => prev.map((turn) => (turn.id === id ? fn(turn) : turn)));
    },
    [update],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  const clear = useCallback(() => {
    stop();
    resetRef.current = true;
    update(() => []);
  }, [stop, update]);

  const send = useCallback(
    async (text: string, {projectId, sessionId, model, layer}: SendOptions) => {
      const content = text.trim();
      if (!content || isRunning) return;

      // The server keeps the real transcript (tool calls included), so this
      // request carries only the new turn. `resetPending` tells it to start over
      // after the user hit Clear.
      const outbound = withLayer(content, layer);
      const reset = resetRef.current;
      resetRef.current = false;

      const replyId = nextId();
      update((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'user',
          text: content,
          apiText: withLayer(content, layer),
          calls: [],
          notes: [],
        },
        {id: replyId, role: 'assistant', text: '', calls: [], notes: []},
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);

      try {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          signal: controller.signal,
          body: JSON.stringify({projectId, sessionId, model, message: outbound, reset}),
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error ?? `Agent request failed (${response.status}).`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const {done, value} = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, {stream: true});
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }

            switch (event.type) {
              case 'status':
                patchTurn(replyId, (turn) => ({
                  ...turn,
                  text: turn.text ? `${turn.text}\n\n${event.text}` : String(event.text),
                }));
                break;

              case 'tool':
                patchTurn(replyId, (turn) => ({
                  ...turn,
                  calls: [
                    ...turn.calls,
                    {
                      key: String(event.id),
                      name: String(event.name),
                      target: String(event.summary ?? ''),
                      status: 'running',
                    },
                  ],
                }));
                break;

              case 'tool_result':
                patchTurn(replyId, (turn) => ({
                  ...turn,
                  calls: turn.calls.map((call) =>
                    call.key === event.id
                      ? {
                          ...call,
                          status: event.ok ? 'complete' : 'error',
                          resultDetail: String(event.preview ?? ''),
                          errorMessage: event.ok ? undefined : String(event.preview ?? 'Failed'),
                        }
                      : call,
                  ),
                }));
                break;

              case 'branch':
                patchTurn(replyId, (turn) => ({...turn, notes: [...turn.notes, String(event.text)]}));
                break;

              case 'text':
                patchTurn(replyId, (turn) => ({...turn, text: String(event.text)}));
                break;

              case 'error':
                patchTurn(replyId, (turn) => ({...turn, error: String(event.text)}));
                break;
            }
          }
        }
      } catch (caught) {
        if ((caught as Error)?.name !== 'AbortError') {
          patchTurn(replyId, (turn) => ({...turn, error: (caught as Error).message}));
        }
      } finally {
        abortRef.current = null;
        setIsRunning(false);
      }
    },
    [isRunning, patchTurn, update],
  );

  return {turns, isRunning, send, stop, clear};
}
