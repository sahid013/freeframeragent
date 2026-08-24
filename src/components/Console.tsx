'use client';

import {useCallback, useEffect, useState} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {SideNav, SideNavHeading, SideNavItem, SideNavSection} from '@astryxdesign/core/SideNav';
import {
  ChatLayout,
  ChatMessageList,
  ChatMessage,
  ChatMessageBubble,
  ChatComposer,
  ChatToolCalls,
} from '@astryxdesign/core/Chat';
import {Markdown} from '@astryxdesign/core/Markdown';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Text} from '@astryxdesign/core/Text';
import {Spinner} from '@astryxdesign/core/Spinner';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {useFramerAgent, type AttachedLayer} from '@/lib/useFramerAgent';
import {ElementPicker} from '@/components/ElementPicker';
import {MemoryPanel} from '@/components/MemoryPanel';
import {ALLOWED_MODELS, DEFAULT_AGENT_MODEL, MODEL_LABELS, type AgentModel} from '@/lib/models';

type Project = {projectId: string; name?: string; lastUsedAt?: string};

type SessionState =
  | {status: 'idle'}
  | {status: 'connecting'}
  | {status: 'ready'; sessionId: string}
  | {status: 'error'; message: string};

export function Console() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState>({status: 'idle'});
  const [model, setModel] = useState<AgentModel>(DEFAULT_AGENT_MODEL);
  const [draft, setDraft] = useState('');
  const [layer, setLayer] = useState<AttachedLayer | null>(null);
  const [memoryVersion, setMemoryVersion] = useState(0);

  const [connectUrl, setConnectUrl] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const {turns, isRunning, send, stop, clear} = useFramerAgent();

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? 'Could not load projects.');
      setProjects(data.projects ?? []);
      setLoadError(null);
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    // A finished run may have saved new notes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isRunning) setMemoryVersion((v) => v + 1);
  }, [isRunning]);

  useEffect(() => {
    // Fetch-on-mount: every setState inside runs after an await, in a promise
    // callback, so this is a subscription to an external system rather than the
    // cascading synchronous render the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProjects();
  }, [loadProjects]);

  /** Opening a project also regenerates the guidance the agent reads. */
  const openProject = useCallback(
    async (projectId: string) => {
      if (isRunning) stop();
      setActiveId(projectId);
      setLayer(null);
      clear();
      setSession({status: 'connecting'});

      try {
        const response = await fetch('/api/session', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({projectId}),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? 'Could not open a session.');
        setSession({status: 'ready', sessionId: data.sessionId});
      } catch (error) {
        setSession({status: 'error', message: (error as Error).message});
      }
    },
    [clear, isRunning, stop],
  );

  const connectProject = useCallback(async () => {
    const value = connectUrl.trim();
    if (!value || isConnecting) return;

    setIsConnecting(true);
    setConnectError(null);

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({project: value}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? 'Authorization failed.');
      setProjects(data.projects ?? []);
      setConnectUrl('');
    } catch (error) {
      setConnectError((error as Error).message);
    } finally {
      setIsConnecting(false);
    }
  }, [connectUrl, isConnecting]);

  const submit = (value: string) => {
    const text = value.trim();
    if (!text || session.status !== 'ready' || !activeId) return;
    setDraft('');
    void send(text, {projectId: activeId, sessionId: session.sessionId, model, layer});
  };

  const active = projects.find((p) => p.projectId === activeId);

  const sideNav = (
    <SideNav
      header={<SideNavHeading heading="Framer Agent" subheading="Connected projects" />}
      topContent={
        <VStack gap={1.5} padding={2}>
          <TextInput
            label="Project URL"
            placeholder="https://framer.com/projects/…"
            value={connectUrl}
            onChange={setConnectUrl}
            isDisabled={isConnecting}
            size="sm"
          />
          <Button
            label={isConnecting ? 'Waiting for approval…' : 'Connect'}
            variant="primary"
            size="sm"
            width="100%"
            isLoading={isConnecting}
            onClick={() => void connectProject()}
          />
          <Text type="supporting">
            {isConnecting
              ? 'Approve the project in the browser tab that just opened.'
              : 'Paste a project URL — Framer will ask you to approve it.'}
          </Text>
          {connectError ? (
            <Text type="supporting" color="secondary">
              {connectError}
            </Text>
          ) : null}
        </VStack>
      }
      footer={
        <VStack gap={1} padding={2}>
          <Selector
            label="Model"
            value={model}
            onChange={(value: string) => setModel(value as AgentModel)}
            options={ALLOWED_MODELS.map((id) => ({value: id, label: MODEL_LABELS[id]}))}
            size="sm"
          />
        </VStack>
      }>
      <SideNavSection title="Projects" isHeaderHidden>
        {projects.map((project) => (
          <SideNavItem
            key={project.projectId}
            label={project.name ?? project.projectId}
            isSelected={project.projectId === activeId}
            onClick={() => void openProject(project.projectId)}
            endContent={
              project.projectId === activeId && session.status === 'connecting' ? (
                <Spinner size="sm" />
              ) : undefined
            }
          />
        ))}
      </SideNavSection>
    </SideNav>
  );

  return (
    <AppShell sideNav={sideNav} height="fill" contentPadding={0}>
      {loadError ? <Banner status="error" container="section" title="Framer CLI" description={loadError} /> : null}

      {!activeId ? (
        <EmptyState
          title="Pick a project"
          description="Choose a Framer project on the left, then describe the change you want. The agent edits the live project."
        />
      ) : (
        <VStack height="100%" gap={0}>
          <HStack gap={2} vAlign="center" padding={3}>
            <Text weight="semibold">{active?.name ?? activeId}</Text>
            {session.status === 'ready' ? <Badge variant="success" label="Connected" /> : null}
            {session.status === 'connecting' ? <Badge label="Connecting…" /> : null}
            {turns.length > 0 ? (
              <Button label="Clear" variant="ghost" size="sm" onClick={clear} />
            ) : null}
          </HStack>

          {session.status === 'error' ? (
            <Banner
              status="error"
              container="section"
              title="Could not open a session"
              description={session.message}
            />
          ) : null}

          <div style={{flex: 1, minHeight: 0, display: 'flex'}}>
            <div style={{flex: 1, minWidth: 0, display: 'flex'}}>
            <ChatLayout
              composer={
                <ChatComposer
                  value={draft}
                  onChange={setDraft}
                  onSubmit={submit}
                  onStop={stop}
                  isStopShown={isRunning}
                  isDisabled={session.status !== 'ready'}
                  headerContext={
                    layer ? (
                      <HStack gap={1} vAlign="center">
                        <Badge variant="info" label={`Editing: ${layer.name}`} />
                        <Button
                          label="Clear"
                          variant="ghost"
                          size="sm"
                          onClick={() => setLayer(null)}
                        />
                      </HStack>
                    ) : undefined
                  }
                  placeholder={
                    session.status === 'ready'
                      ? 'Describe the change — “make the hero headline shorter and bolder”'
                      : 'Connecting to the project…'
                  }
                />
              }
              emptyState={
                <EmptyState
                  title={`Editing ${active?.name ?? 'your project'}`}
                  description="Ask for a change and the agent will inspect the project, read Framer's design rules, and apply it."
                />
              }>
              {turns.length > 0 ? (
                <ChatMessageList isStreaming={isRunning}>
                  {turns.map((turn) => {
                    const isAssistant = turn.role === 'assistant';
                    const isEmpty = !turn.text && !turn.calls.length && !turn.error;

                    if (isAssistant && isEmpty) return null;

                    return (
                      <ChatMessage key={turn.id} sender={turn.role}>
                        {isAssistant ? (
                          <ChatMessageBubble variant="ghost" name="Agent" width="100%">
                            <VStack gap={2}>
                              {turn.calls.length > 0 ? (
                                <ChatToolCalls calls={turn.calls} />
                              ) : null}
                              {turn.notes.map((note) => (
                                <Badge key={note} variant="info" label={note} />
                              ))}
                              {turn.text ? (
                                <Markdown isStreaming={isRunning} density="compact">
                                  {turn.text}
                                </Markdown>
                              ) : null}
                              {turn.error ? (
                                <Banner status="error" title="Failed" description={turn.error} />
                              ) : null}
                            </VStack>
                          </ChatMessageBubble>
                        ) : (
                          <ChatMessageBubble>{turn.text}</ChatMessageBubble>
                        )}
                      </ChatMessage>
                    );
                  })}
                </ChatMessageList>
              ) : null}
            </ChatLayout>
            </div>

            {session.status === 'ready' ? (
              <aside
                style={{
                  width: 320,
                  flexShrink: 0,
                  minWidth: 0,
                  minHeight: 0,
                  overflow: 'hidden',
                  borderInlineStart: '1px solid var(--color-border)',
                }}>
                <VStack height="100%" gap={0} isScrollable>
                  <MemoryPanel projectId={activeId} refreshKey={memoryVersion} />
                  <ElementPicker
                    sessionId={session.sessionId}
                    attached={layer}
                    onAttach={setLayer}
                  />
                </VStack>
              </aside>
            ) : null}
          </div>
        </VStack>
      )}
    </AppShell>
  );
}
