import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Durable per-project notes.
 *
 * The expensive part of editing a Framer project is *locating* things — walking
 * a component tree for ten steps to learn that the hero headline is a RichText
 * node inside "Hero 2". That finding is stable, so the agent writes it down here
 * and every later session starts already knowing it.
 *
 * Stored on disk, keyed by project, so it survives new sessions and restarts.
 */

export type MemoryNote = {
  key: string;
  note: string;
  updatedAt: string;
};

const MAX_NOTES = 80;
const MAX_NOTE_CHARS = 2_000;

function memoryDir(): string {
  return path.join(process.cwd(), '.data', 'memory');
}

function safeProjectId(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function memoryPath(projectId: string): string {
  return path.join(memoryDir(), `${safeProjectId(projectId)}.json`);
}

export async function readMemory(projectId: string): Promise<MemoryNote[]> {
  try {
    const raw = await fs.readFile(memoryPath(projectId), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.notes) ? parsed.notes : [];
  } catch {
    return [];
  }
}

async function writeMemory(projectId: string, notes: MemoryNote[]): Promise<void> {
  await fs.mkdir(memoryDir(), {recursive: true});
  await fs.writeFile(
    memoryPath(projectId),
    JSON.stringify({projectId, notes}, null, 2),
    'utf-8',
  );
}

/** Upsert by key, newest last, oldest dropped past the cap. */
export async function remember(
  projectId: string,
  key: string,
  note: string,
): Promise<MemoryNote[]> {
  const trimmedKey = key.trim().slice(0, 120);
  if (!trimmedKey) throw new Error('A memory needs a key.');

  const notes = (await readMemory(projectId)).filter((n) => n.key !== trimmedKey);
  notes.push({
    key: trimmedKey,
    note: note.trim().slice(0, MAX_NOTE_CHARS),
    updatedAt: new Date().toISOString(),
  });

  const capped = notes.slice(-MAX_NOTES);
  await writeMemory(projectId, capped);
  return capped;
}

export async function forget(projectId: string, key: string): Promise<MemoryNote[]> {
  const notes = (await readMemory(projectId)).filter((n) => n.key !== key.trim());
  await writeMemory(projectId, notes);
  return notes;
}

export async function clearMemory(projectId: string): Promise<void> {
  await writeMemory(projectId, []);
}

/** Rendered into the system prompt so recall costs nothing at run time. */
export function renderMemory(notes: MemoryNote[]): string {
  if (!notes.length) return '';
  return notes.map((n) => `- ${n.key}: ${n.note}`).join('\n');
}
