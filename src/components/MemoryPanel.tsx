'use client';

import {useCallback, useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {HStack, VStack} from '@astryxdesign/core/Stack';

type MemoryNote = {key: string; note: string; updatedAt: string};

/**
 * What the agent has learned about this project and kept.
 *
 * Notes are written by the agent's `remember` tool and fed back into its system
 * prompt, which is what stops it re-walking the tree on every request.
 */
export function MemoryPanel({
  projectId,
  refreshKey,
}: {
  projectId: string;
  /** Bump to re-read after a run finishes. */
  refreshKey: number;
}) {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [isClearing, setIsClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/memory?projectId=${encodeURIComponent(projectId)}`);
      const data = await response.json();
      if (response.ok) setNotes(data.notes ?? []);
    } catch {
      // A missing memory file just means nothing learned yet.
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  const clear = useCallback(async () => {
    setIsClearing(true);
    try {
      await fetch(`/api/memory?projectId=${encodeURIComponent(projectId)}`, {method: 'DELETE'});
      setNotes([]);
    } finally {
      setIsClearing(false);
    }
  }, [projectId]);

  return (
    <VStack gap={1.5} padding={3} width="100%" style={{minWidth: 0}}>
      <HStack gap={2} vAlign="center" justify="between" width="100%">
        <HStack gap={1.5} vAlign="center">
          <Text type="label">Memory</Text>
          <Badge label={String(notes.length)} variant={notes.length ? 'success' : 'neutral'} />
        </HStack>
        {notes.length > 0 ? (
          <Button
            label="Clear"
            variant="ghost"
            size="sm"
            isLoading={isClearing}
            onClick={() => void clear()}
          />
        ) : null}
      </HStack>

      {notes.length === 0 ? (
        <Text type="supporting">
          Nothing learned yet. As the agent locates things it saves them here, so later requests skip
          the search.
        </Text>
      ) : (
        <VStack gap={1} width="100%" style={{minWidth: 0}}>
          {notes.map((note) => (
            <Collapsible
              key={note.key}
              defaultIsOpen={false}
              trigger={<Text type="supporting">{note.key}</Text>}>
              <Text type="supporting">{note.note}</Text>
            </Collapsible>
          ))}
        </VStack>
      )}
    </VStack>
  );
}
