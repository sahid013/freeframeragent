'use client';

import {useState} from 'react';
import {
  ChatLayout,
  ChatMessageList,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageMetadata,
  ChatComposer,
} from '@astryxdesign/core/Chat';
import {Markdown} from '@astryxdesign/core/Markdown';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Button} from '@astryxdesign/core/Button';
import {Avatar} from '@astryxdesign/core/Avatar';
import {Text} from '@astryxdesign/core/Text';
import {useAgentChat} from '@/lib/useAgentChat';
import type {Agent} from '@/lib/agents';

export type AgentChatProps = {
  agentId: string;
  agent: Agent;
  model?: string;
  endpoint?: string;
  density?: 'compact' | 'balanced' | 'spacious';
  /** Turn off the suggestion buttons in the empty state. */
  showSuggestions?: boolean;
  avatarSrc?: string;
};

export function AgentChat({
  agentId,
  agent,
  model,
  endpoint = '/api/chat',
  density = 'balanced',
  showSuggestions = true,
  avatarSrc,
}: AgentChatProps) {
  const {messages, isStreaming, error, send, stop} = useAgentChat({
    endpoint,
    agent: agentId,
    model,
  });
  const [draft, setDraft] = useState('');

  const submit = (value: string) => {
    const text = value.trim();
    if (!text) return;
    setDraft('');
    void send(text);
  };

  const suggestions = showSuggestions ? (agent.suggestions ?? []) : [];

  return (
    <ChatLayout
      composer={
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          isStopShown={isStreaming}
          placeholder={agent.placeholder}
          density={density}
          status={error ? {type: 'error', message: error} : undefined}
        />
      }
      emptyState={
        <EmptyState
          title={agent.greeting}
          description={`You’re talking to ${agent.name}. Replies stream in live.`}
          actions={suggestions.map((suggestion) => (
            <Button
              key={suggestion}
              label={suggestion}
              variant="secondary"
              size="sm"
              onClick={() => submit(suggestion)}
            />
          ))}
        />
      }>
      {messages.length > 0 ? (
        <ChatMessageList density={density} isStreaming={isStreaming}>
          {messages.map((message, index) => {
            const isAssistant = message.role === 'assistant';
            const isLast = index === messages.length - 1;

            return (
              <ChatMessage
                key={message.id}
                sender={message.role}
                avatar={
                  isAssistant ? (
                    <Avatar size="md" name={agent.handle} src={avatarSrc} />
                  ) : undefined
                }>
                <ChatMessageBubble
                  variant={isAssistant ? 'ghost' : 'filled'}
                  name={isAssistant ? agent.handle : undefined}
                  metadata={
                    isAssistant && !(isLast && isStreaming) ? (
                      <ChatMessageMetadata
                        footer={<Text type="supporting">{model ?? 'auto'}</Text>}
                      />
                    ) : undefined
                  }>
                  {isAssistant ? (
                    <Markdown isStreaming={isLast && isStreaming} density="compact">
                      {message.content}
                    </Markdown>
                  ) : (
                    message.content
                  )}
                </ChatMessageBubble>
              </ChatMessage>
            );
          })}
        </ChatMessageList>
      ) : null}
    </ChatLayout>
  );
}
