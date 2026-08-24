'use client';

import {useCallback, useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Spinner} from '@astryxdesign/core/Spinner';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Breadcrumbs, BreadcrumbItem} from '@astryxdesign/core/Breadcrumbs';
import type {AttachedLayer} from '@/lib/useFramerAgent';

type TreeNode = {
  id: string;
  name: string;
  type: string;
  childCount: number;
  text?: string;
};

type TreeLevel = {id: string; name: string; type: string; children: TreeNode[]};

/**
 * Browse the project's layer tree and hand one layer to the composer.
 *
 * Framer's headless connection can't see what's selected in the editor window,
 * so picking happens here — and every pick calls setSelection, which highlights
 * the same layer in Framer so the user can confirm the target.
 */
export function ElementPicker({
  sessionId,
  attached,
  onAttach,
}: {
  sessionId: string;
  attached: AttachedLayer | null;
  onAttach: (layer: AttachedLayer | null) => void;
}) {
  const [trail, setTrail] = useState<TreeLevel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLevel = useCallback(
    async (nodeId?: string, {replace = false}: {replace?: boolean} = {}) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/tree', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({sessionId, nodeId}),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? 'Could not read the layer tree.');

        setTrail((prev) => (replace ? [data.level] : [...prev, data.level]));
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    // Reset to the page list whenever the session changes. loadLevel writes its
    // state after an await, so only this reset is synchronous — and it must be,
    // to avoid rendering the previous project's tree for a frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrail([]);
    void loadLevel(undefined, {replace: true});
  }, [loadLevel]);

  /** Attach a layer to the next prompt and highlight it in Framer. */
  const attach = useCallback(
    async (node: TreeNode) => {
      setBusyId(node.id);
      setError(null);

      try {
        const response = await fetch('/api/selection', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({sessionId, nodeId: node.id}),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? 'Could not read that layer.');

        const {id, name, type, snippet} = data.selection;
        onAttach({id, name, type, snippet});
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [onAttach, sessionId],
  );

  const level = trail[trail.length - 1];

  return (
    <VStack gap={2} padding={3} height="100%" width="100%" isScrollable style={{minWidth: 0}}>
      <HStack gap={2} vAlign="center">
        <Text type="label">Elements</Text>
        {isLoading ? <Spinner size="sm" /> : null}
      </HStack>

      <Breadcrumbs>
        {trail.map((entry, index) => (
          <BreadcrumbItem
            key={`${entry.id}-${index}`}
            isCurrent={index === trail.length - 1}
            onClick={() => setTrail((prev) => prev.slice(0, index + 1))}>
            {entry.name}
          </BreadcrumbItem>
        ))}
      </Breadcrumbs>

      {error ? (
        <Text type="supporting" color="secondary">
          {error}
        </Text>
      ) : null}

      <VStack gap={1} width="100%" style={{minWidth: 0}}>
        {level?.children.map((node) => {
          const isAttached = attached?.id === node.id;

          return (
            <VStack
              key={node.id}
              gap={0.5}
              padding={1.5}
              width="100%"
              style={{
                minWidth: 0,
                borderRadius: 'var(--radius-element)',
                background: isAttached ? 'var(--color-background-muted)' : 'transparent',
              }}>
              <HStack gap={1.5} vAlign="center" justify="between" width="100%">
                <VStack gap={0} style={{minWidth: 0, flex: 1}}>
                  <Text type="body" maxLines={1}>
                    {node.name}
                  </Text>
                  <Text type="supporting" maxLines={1}>
                    {node.type.replace(/Node$/, '')}
                    {node.text ? ` · ${node.text}` : ''}
                  </Text>
                </VStack>

                <HStack gap={1} style={{flexShrink: 0}}>
                  {node.childCount > 0 ? (
                    <Button
                      label={`Open (${node.childCount})`}
                      variant="ghost"
                      size="sm"
                      onClick={() => void loadLevel(node.id)}
                    />
                  ) : null}
                  <Button
                    label={isAttached ? 'Attached' : 'Use'}
                    variant={isAttached ? 'primary' : 'secondary'}
                    size="sm"
                    isLoading={busyId === node.id}
                    onClick={() => void attach(node)}
                  />
                </HStack>
              </HStack>
            </VStack>
          );
        })}
      </VStack>

      {attached ? (
        <HStack gap={1.5} vAlign="center">
          <Badge variant="info" label={`Attached: ${attached.name}`} />
          <Button label="Clear" variant="ghost" size="sm" onClick={() => onAttach(null)} />
        </HStack>
      ) : null}
    </VStack>
  );
}
