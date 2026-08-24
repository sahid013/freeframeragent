'use client';

import {useCallback, useRef, useState} from 'react';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type Options = {
  /** Absolute or relative URL of the proxy route. */
  endpoint: string;
  agent: string;
  model?: string;
};

let counter = 0;
const nextId = () => `m${++counter}-${Date.now().toString(36)}`;

type Delta = {kind: 'content' | 'reasoning'; text: string};

/**
 * Reads an OpenAI-style SSE stream, yielding content and reasoning deltas.
 *
 * OpenRouter interleaves `: OPENROUTER PROCESSING` keep-alive comments with the
 * data frames, and a chunk can split mid-line, so we buffer and only act on
 * complete `data:` lines.
 *
 * Reasoning models (Ox Alpha among them) stream a long run of `delta.reasoning`
 * with empty `content` before answering — 35 frames before the first word, in
 * one measured case. Surfacing that as a distinct kind is what stops the widget
 * showing a visitor nothing at all while the model thinks.
 */
async function* readDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<Delta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta;
          if (typeof delta?.content === 'string' && delta.content) {
            yield {kind: 'content', text: delta.content};
          } else if (typeof delta?.reasoning === 'string' && delta.reasoning) {
            yield {kind: 'reasoning', text: delta.reasoning};
          }
        } catch {
          // Partial or non-JSON frame — skip it.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function useAgentChat({endpoint, agent, model}: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  /** Reasoning has started but no answer text has arrived yet. */
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Mirror of `messages` that updates synchronously. A `setMessages` updater
   * runs during render, not at call time, so it can't be used to read the
   * current history before firing the request.
   */
  const messagesRef = useRef<ChatMessage[]>([]);

  const update = useCallback((fn: (prev: ChatMessage[]) => ChatMessage[]) => {
    messagesRef.current = fn(messagesRef.current);
    setMessages(messagesRef.current);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setIsThinking(false);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || isStreaming) return;

      setError(null);

      const userMessage: ChatMessage = {id: nextId(), role: 'user', content};
      const replyId = nextId();
      const history = [...messagesRef.current, userMessage];

      update(() => [...history, {id: replyId, role: 'assistant', content: ''}]);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          signal: controller.signal,
          body: JSON.stringify({
            agent,
            model,
            messages: history.map(({role, content: c}) => ({role, content: c})),
          }),
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error ?? `Request failed (${response.status}).`);
        }

        for await (const delta of readDeltas(response.body)) {
          if (delta.kind === 'reasoning') {
            setIsThinking(true);
            continue;
          }

          setIsThinking(false);
          update((prev) =>
            prev.map((m) => (m.id === replyId ? {...m, content: m.content + delta.text} : m)),
          );
        }
      } catch (caught) {
        if ((caught as Error)?.name === 'AbortError') {
          // Stopped on purpose — keep whatever streamed in so far.
        } else {
          setError((caught as Error)?.message ?? 'Something went wrong.');
        }
      } finally {
        // Drop the placeholder if nothing ever arrived.
        update((prev) => prev.filter((m) => !(m.id === replyId && m.content === '')));
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [endpoint, agent, model, isStreaming, update],
  );

  const reset = useCallback(() => {
    stop();
    update(() => []);
    setError(null);
  }, [stop, update]);

  return {messages, isStreaming, isThinking, error, send, stop, reset};
}
