import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import path from 'node:path';

/**
 * Thin wrapper over the `@framer/agent` CLI.
 *
 * That CLI owns a local relay server (127.0.0.1:19988) which holds an
 * authenticated websocket to each Framer project. A *session* binds to one
 * project; every `exec` runs JavaScript against that project's live document
 * with the Framer plugin API available as `framer`.
 *
 * This is why the console runs locally rather than on Vercel: it needs the
 * relay and the credentials in ~/.config/framer.
 */

const run = promisify(execFile);

let cached: string | null = null;

/**
 * Locate the CLI entry point by walking up from the working directory.
 *
 * Resolved from cwd rather than `import.meta.url`: the bundler rewrites module
 * URLs to a virtual `[project]` path at build time, which breaks require.resolve.
 */
function cliPath(): string {
  if (cached) return cached;

  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, 'node_modules', '@framer', 'agent', 'dist', 'cli.js');
    if (existsSync(candidate)) {
      cached = candidate;
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error('Could not find @framer/agent. Run `npm install` in the project root.');
}

export type FramerProject = {
  projectId: string;
  name?: string;
  lastUsedAt?: string;
};

export type ExecResult = {
  ok: boolean;
  output: string;
  /** Framer emits this marker when an edit lands on a new auto-created branch. */
  branchChanged: boolean;
};

const TWO_MINUTES = 120_000;

async function cli(
  args: string[],
  {input, timeout = TWO_MINUTES}: {input?: string; timeout?: number} = {},
): Promise<{stdout: string; stderr: string; code: number}> {
  try {
    const child = run('node', [cliPath(), ...args], {
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      // The CLI writes credentials and generated project context under $HOME.
      env: process.env,
    });

    if (input !== undefined) {
      child.child.stdin?.end(input);
    }

    const {stdout, stderr} = await child;
    return {stdout, stderr, code: 0};
  } catch (error) {
    const err = error as {stdout?: string; stderr?: string; code?: number; message?: string};
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? 'Unknown CLI failure',
      code: typeof err.code === 'number' ? err.code : 1,
    };
  }
}

/** Projects the user has already authorized, newest first. */
export async function listProjects(): Promise<FramerProject[]> {
  const {stdout, stderr, code} = await cli(['project', 'list']);
  if (code !== 0) throw new Error(stderr || 'Could not list Framer projects.');

  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`Unexpected output from \`project list\`: ${stdout.slice(0, 200)}`);
  }
}

/**
 * Authorize a project. This opens the user's browser to framer.com for
 * approval, so it can sit waiting for a while — hence the longer timeout.
 */
export async function authProject(projectUrlOrId: string): Promise<void> {
  const {stderr, code} = await cli(['project', 'auth', projectUrlOrId], {timeout: 5 * 60_000});
  if (code !== 0) throw new Error(stderr || 'Authorization failed or was cancelled.');
}

/**
 * Open a session against a project. Also regenerates that project's context
 * bundle under the installed framer skill, which `readProjectContext` reads.
 */
export async function createSession(projectId: string): Promise<string> {
  const {stdout, stderr, code} = await cli(['session', 'new', projectId], {timeout: 3 * 60_000});
  if (code !== 0) throw new Error(stderr || 'Could not open a session.');

  const sessionId = stdout.trim().split('\n').pop()?.trim();
  if (!sessionId) throw new Error('Session created but no id was returned.');
  return sessionId;
}

/** Run JavaScript against the connected project. `framer` and `state` are in scope. */
export async function execCode(sessionId: string, code: string): Promise<ExecResult> {
  // Send code on stdin so quoting never mangles it.
  const {stdout, stderr, code: exitCode} = await cli(['exec', '-s', sessionId], {input: code});
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();

  return {
    ok: exitCode === 0,
    output: output || (exitCode === 0 ? '(no output)' : 'Failed with no output.'),
    branchChanged: output.includes('[FRAMER_BRANCH_CHANGE]'),
  };
}

/** Look up plugin API signatures, e.g. `Collection.getItems`. */
export async function lookupDocs(queries: string[]): Promise<string> {
  const {stdout, stderr, code} = await cli(['docs', ...queries], {timeout: 60_000});
  if (code !== 0) return stderr || 'No documentation found.';
  return stdout.trim() || 'No documentation found.';
}
