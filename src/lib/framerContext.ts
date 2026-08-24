import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Reader for the per-project context bundle that `session new` generates.
 *
 * Framer writes ~250KB of guidance per project (DSL grammar, layout rules,
 * worked examples, plus a live inventory of that project's pages, components,
 * CMS and styles). Far too much to put in every request, so the agent gets a
 * small always-on core plus a `read_context` tool to pull in the sections its
 * task map points to.
 */

const SKILL_ROOTS = [
  path.join(os.homedir(), '.claude', 'skills', 'framer', 'projects'),
  path.join(os.homedir(), '.agents', 'skills', 'framer', 'projects'),
];

/** Mirrors the CLI's own sanitiser for on-disk directory names. */
function safeProjectId(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export async function contextDir(projectId: string): Promise<string | null> {
  const safe = safeProjectId(projectId);
  for (const root of SKILL_ROOTS) {
    const dir = path.join(root, safe);
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory()) return dir;
    } catch {
      // Try the next root.
    }
  }
  return null;
}

/** Relative paths of every context file available for this project. */
export async function listContextFiles(projectId: string): Promise<string[]> {
  const dir = await contextDir(projectId);
  if (!dir) return [];

  const entries = await fs.readdir(dir, {recursive: true, withFileTypes: true});
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

/** Cap a single file so one huge section can't blow the context budget. */
const MAX_FILE_CHARS = 60_000;

export async function readContextFiles(
  projectId: string,
  names: string[],
): Promise<{name: string; content: string}[]> {
  const dir = await contextDir(projectId);
  if (!dir) throw new Error('No generated context for this project. Open a session first.');

  const results: {name: string; content: string}[] = [];

  for (const name of names.slice(0, 6)) {
    // Keep reads inside the project's own context directory.
    const target = path.resolve(dir, name);
    if (target !== dir && !target.startsWith(dir + path.sep)) {
      results.push({name, content: 'Refused: path is outside the project context directory.'});
      continue;
    }

    try {
      const content = await fs.readFile(target, 'utf-8');
      results.push({
        name,
        content:
          content.length > MAX_FILE_CHARS
            ? `${content.slice(0, MAX_FILE_CHARS)}\n\n…truncated (${content.length} chars total).`
            : content,
      });
    } catch {
      results.push({name, content: 'Not found. Call list_context to see what exists.'});
    }
  }

  return results;
}

async function readOptional(dir: string, name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, name), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * The always-on part of the system prompt: house rules, the task map that tells
 * the agent which sections to read, and the project's own inventory.
 */
export async function coreContext(projectId: string): Promise<string> {
  const dir = await contextDir(projectId);
  if (!dir) return '';

  const parts = await Promise.all([
    readOptional(dir, 'index.md'),
    readOptional(dir, path.join('prompt', 'overview.md')),
    readOptional(dir, path.join('prompt', 'guardrails.md')),
    readOptional(dir, path.join('prompt', 'critical-reminders.md')),
    readOptional(dir, 'project-inventory.md'),
  ]);

  return parts.filter(Boolean).join('\n\n---\n\n');
}
