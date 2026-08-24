import {execCode, lookupDocs} from '@/lib/framer';
import {coreContext, listContextFiles, readContextFiles} from '@/lib/framerContext';
import {forget, readMemory, remember, renderMemory} from '@/lib/projectMemory';

/**
 * The agent loop: your OpenRouter model, with tools that reach into a live
 * Framer project.
 *
 * Each turn the model can call tools; results are fed back and it goes again,
 * until it answers with plain text or hits the step ceiling.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Per-step reply cap.
 *
 * OpenRouter reserves max_tokens against your balance *before* running the
 * call, so on a paid model with a small balance an uncapped request 402s. On a
 * zero-cost model there's nothing to reserve and the cap only exists to stop a
 * runaway reply — set AGENT_MAX_TOKENS=0 to drop it entirely.
 *
 * The default is generous because edits are the expensive case: an
 * applyChanges payload for a whole section is far bigger than a chat reply, and
 * a cap that truncates it mid-JSON fails the edit.
 */
function maxTokens(): {max_tokens?: number} {
  const configured = Number(process.env.AGENT_MAX_TOKENS ?? 8192);
  return Number.isFinite(configured) && configured > 0 ? {max_tokens: configured} : {};
}

/**
 * Ceiling on tool round-trips per user message, so a confused model can't spin.
 * Set generously: a real edit routinely spends 10+ steps walking the component
 * tree before it finds the node to change.
 */
const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS ?? 20);

export type AgentEvent =
  | {type: 'status'; text: string}
  | {type: 'tool'; id: string; name: string; summary: string}
  | {type: 'tool_result'; id: string; ok: boolean; preview: string}
  | {type: 'text'; text: string}
  | {type: 'branch'; text: string}
  | {type: 'error'; text: string}
  | {type: 'done'; steps: number};

type ToolCall = {
  id: string;
  type: 'function';
  function: {name: string; arguments: string};
};

export type ApiMessage =
  | {role: 'system' | 'user'; content: string}
  | {role: 'assistant'; content: string | null; tool_calls?: ToolCall[]}
  | {role: 'tool'; tool_call_id: string; content: string};

export type ChatTurn = {role: 'user' | 'assistant'; content: string};

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_context',
      description:
        'List the Framer guidance files available for this project (DSL grammar, layout rules, worked examples, per-domain guides). Call this if you are unsure which section to read.',
      parameters: {type: 'object', properties: {}, required: []},
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_context',
      description:
        "Read Framer guidance files for this project. Follow the task map in index.md: read the 'Anything' row before your first edit, plus the row matching the task. Up to 6 files per call.",
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: {type: 'string'},
            description:
              "Relative paths, e.g. ['prompt/core-principles.md', 'prompt/updating-the-project.md'].",
          },
        },
        required: ['files'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'framer_exec',
      description:
        'Run JavaScript against the connected Framer project. `framer` is the plugin API, `state` persists between calls in this session, `console.log` returns output. Use framer.agent.* methods (applyChanges, getNode, getNodesOfTypes, serialize, publish) in preference to low-level node APIs. This is how you both read and edit the project.',
      parameters: {
        type: 'object',
        properties: {
          purpose: {
            type: 'string',
            description: 'One short line, shown to the user, e.g. "Reading the hero section".',
          },
          code: {type: 'string', description: 'The JavaScript to run. Top-level await is allowed.'},
        },
        required: ['purpose', 'code'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remember',
      description:
        "Save a durable note about THIS project so you never have to rediscover it. Use it the moment you locate something that cost you steps: node ids, where a section lives, which component owns a headline, and the exact working snippet you used. Notes persist across sessions and are handed to you automatically next time. Overwrites the same key.",
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Short stable identifier, e.g. "home.hero.headline".',
          },
          note: {
            type: 'string',
            description:
              'The finding: node ids, the path to it, and the snippet that worked. Write it so a fresh session could act on it without searching.',
          },
        },
        required: ['key', 'note'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'forget',
      description:
        'Delete a saved note by key. Use when the project changed and a note is now wrong.',
      parameters: {
        type: 'object',
        properties: {key: {type: 'string'}},
        required: ['key'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'framer_docs',
      description:
        'Look up Framer plugin API signatures by name, e.g. ["Collection", "Collection.getItems"]. Use only for methods whose signature is not already in the guidance you have read.',
      parameters: {
        type: 'object',
        properties: {
          queries: {type: 'array', items: {type: 'string'}},
        },
        required: ['queries'],
      },
    },
  },
];

const OPERATING_RULES = `
You are a Framer design agent. You are connected to ONE live Framer project and you edit it directly by running code.

## How to work
- Read before you write. The project context below includes a task map (index.md). Before your first edit in a conversation, use \`read_context\` to load the "Anything" row, plus the row matching the task. Don't re-read a file you already have.
- Inspect the live project with \`framer_exec\` before changing it. The inventory below is a snapshot and may be stale.
- Save expensive results on \`state\` so later steps in this session can reuse them.
- **Write down what you find.** Locating a node is the slow part. The moment you find one, call \`remember\` with its id, where it lives, and the snippet that worked. Anything already under "Known about this project" below is yours from earlier — trust it and go straight there instead of re-walking the tree. If a note turns out to be stale, fix it with \`remember\` or drop it with \`forget\`.
- Read your changes back to confirm they landed before you report success.

## Which methods to use
Prefer \`framer.agent.*\` over the generic plugin API whenever an agent method exists.

- Reading the tree: \`getNode\`, \`getNodes\`, \`getNodesOfTypes\`, \`getDescendantsOfTypes\`, \`getDescendantReferencesOfTypes\`, \`getRect\`, \`getScopeNode\`, \`getGroundNode\`, \`getParentNode\`, \`getAncestors\`, \`serialize\`, \`serializeNodes\`, \`paginate\`.
- Reading controls: \`readComponentControls\`, \`readIconSetControls\`, \`readIcons\`, \`readLayoutTemplateControls\`, \`readShaderControls\`.
- Editing: \`framer.agent.applyChanges\` for page, layout, style, CMS-on-canvas, component and design-token work. Do NOT hand-roll \`createNode\`, \`setAttributes\` or \`setRect\` for design work, and create styles/tokens/components through applyChanges so you can reference them later.
- Publishing: \`framer.agent.publish\`.
- Inside exec you also have the globals \`walkWithSkipChildren\` and \`getInnerText\` for traversing serialized nodes.

### Call shapes — every method takes ONE options object, never a positional string
\`\`\`js
await framer.agent.getNode({id})                          // one node
await framer.agent.getNodes({ids: [id, id]})              // several
await framer.agent.serialize({id})                        // node + full children tree
await framer.agent.serializeNodes({ids: [id]})            // several, serialized
await framer.agent.getNodesOfTypes({types: ['WebPageNode']})
await framer.agent.getDescendantsOfTypes({id, types: ['TextNode']})
await framer.agent.getRect({id})                          // {x, y, width, height}
await framer.agent.getParentNode({id})
await framer.setSelection(nodeId)                         // the exception: a bare id
\`\`\`
\`getNode({id: 'x'})\` is correct; \`getNode('x')\` throws a typia assert error. If you see \"Error on typia.createAssert(): invalid type on $input[0]\", you passed the wrong shape — fix the shape, and if still unsure call \`read_context(['prompt/tools.md'])\` rather than guessing a third time.

Do not guess a signature. If an exec call errors twice, stop guessing: \`read_context(['prompt/tools.md'])\` has the authoritative list. \`framer_docs\` only covers the generic plugin API, not \`framer.agent.*\`. Always \`console.log\` what you want returned; exec reports stdout, not the last expression.

## Picked layers
A user message may carry a \`<selected-layer>\` block. That is the layer they clicked in the element picker, already serialized — treat it as the target of the request and don't go hunting for it. Its \`id\` works directly with framer.agent methods. If the request clearly concerns something else, say so rather than editing the wrong thing.

## Talking to the user
- Be concise and concrete. Say what you changed in the user's language — sections, text, colours — not node IDs or escaping details.
- If a request is ambiguous in a way that changes the result, ask before editing.
- Ask for confirmation before deleting content or making changes the user did not clearly request.
- If a tool fails, say what failed and what you're trying instead. Don't claim success you haven't verified.
`.trim();

function summarize(name: string, args: Record<string, unknown>): string {
  if (name === 'framer_exec') return String(args.purpose ?? 'Running code');
  if (name === 'read_context') return `Reading ${(args.files as string[])?.join(', ') ?? 'guidance'}`;
  if (name === 'framer_docs') return `Looking up ${(args.queries as string[])?.join(', ') ?? 'docs'}`;
  if (name === 'list_context') return 'Listing available guidance';
  if (name === 'remember') return `Remembering ${String(args.key ?? '')}`;
  if (name === 'forget') return `Forgetting ${String(args.key ?? '')}`;
  return name;
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: {projectId: string; sessionId: string},
): Promise<{ok: boolean; content: string; branchChanged?: boolean}> {
  switch (name) {
    case 'list_context': {
      const files = await listContextFiles(ctx.projectId);
      return {ok: true, content: files.length ? files.join('\n') : 'No context files generated.'};
    }
    case 'read_context': {
      const files = Array.isArray(args.files) ? (args.files as string[]) : [];
      if (!files.length) return {ok: false, content: 'No files requested.'};
      const docs = await readContextFiles(ctx.projectId, files);
      return {
        ok: true,
        content: docs.map((d) => `===== ${d.name} =====\n${d.content}`).join('\n\n'),
      };
    }
    case 'framer_exec': {
      const code = typeof args.code === 'string' ? args.code : '';
      if (!code.trim()) return {ok: false, content: 'No code supplied.'};
      const result = await execCode(ctx.sessionId, code);
      return {ok: result.ok, content: result.output, branchChanged: result.branchChanged};
    }
    case 'remember': {
      const key = typeof args.key === 'string' ? args.key : '';
      const note = typeof args.note === 'string' ? args.note : '';
      if (!key.trim() || !note.trim()) return {ok: false, content: 'Both key and note are required.'};
      const notes = await remember(ctx.projectId, key, note);
      return {ok: true, content: `Saved "${key}". ${notes.length} notes stored for this project.`};
    }
    case 'forget': {
      const key = typeof args.key === 'string' ? args.key : '';
      if (!key.trim()) return {ok: false, content: 'A key is required.'};
      const notes = await forget(ctx.projectId, key);
      return {ok: true, content: `Dropped "${key}". ${notes.length} notes remain.`};
    }
    case 'framer_docs': {
      const queries = Array.isArray(args.queries) ? (args.queries as string[]) : [];
      if (!queries.length) return {ok: false, content: 'No queries supplied.'};
      return {ok: true, content: await lookupDocs(queries.slice(0, 5))};
    }
    default:
      return {ok: false, content: `Unknown tool: ${name}`};
  }
}

/** Keep a single tool result from swamping the next request. */
function clip(text: string, limit = 12_000): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…truncated (${text.length} chars).` : text;
}

/**
 * Build the system message fresh on every request, so notes saved a moment ago
 * are already in play on the next turn.
 */
export async function buildSystemPrompt(projectId: string): Promise<string> {
  const [project, notes] = await Promise.all([coreContext(projectId), readMemory(projectId)]);

  const memory = renderMemory(notes);
  const sections = [OPERATING_RULES];

  if (memory) {
    sections.push(
      `# Known about this project\n\nYou established these earlier. Treat them as true and act on them directly; verify only if something looks stale.\n\n${memory}`,
    );
  }

  sections.push(
    project
      ? `# Project context\n\n${project}`
      : '(No generated context for this project — inspect it live with framer_exec.)',
  );

  return sections.join('\n\n---\n\n');
}

export async function* runAgent(opts: {
  projectId: string;
  sessionId: string;
  model: string;
  apiKey: string;
  siteUrl: string;
  signal: AbortSignal;
  /**
   * The live transcript, including prior tool calls and their results. Mutated
   * in place so the caller can persist it once the turn ends.
   */
  conversation: ApiMessage[];
}): AsyncGenerator<AgentEvent> {
  const {projectId, sessionId, model, apiKey, siteUrl, signal, conversation} = opts;
  const messages = conversation;

  for (let step = 0; step < MAX_STEPS; step++) {
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': siteUrl,
          'X-Title': 'Framer Agent Console',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
          ...maxTokens(),
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return;
      yield {type: 'error', text: `Could not reach OpenRouter: ${String(error)}`};
      return;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      yield {type: 'error', text: `OpenRouter returned ${response.status}. ${detail.slice(0, 400)}`};
      return;
    }

    const payload = await response.json();
    const choice = payload?.choices?.[0]?.message;

    if (!choice) {
      yield {type: 'error', text: 'OpenRouter returned no message.'};
      return;
    }

    const toolCalls: ToolCall[] = choice.tool_calls ?? [];

    // No tool calls means the model is answering — we're done.
    if (toolCalls.length === 0) {
      const text = typeof choice.content === 'string' ? choice.content : '';
      if (text.trim()) yield {type: 'text', text};
      yield {type: 'done', steps: step};
      return;
    }

    messages.push({role: 'assistant', content: choice.content ?? null, tool_calls: toolCalls});

    // Surface any commentary the model wrote alongside its tool calls.
    if (typeof choice.content === 'string' && choice.content.trim()) {
      yield {type: 'status', text: choice.content.trim()};
    }

    for (const call of toolCalls) {
      if (signal.aborted) return;

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Arguments were not valid JSON. Re-issue the call with valid JSON.',
        });
        continue;
      }

      yield {type: 'tool', id: call.id, name: call.function.name, summary: summarize(call.function.name, args)};

      let result: {ok: boolean; content: string; branchChanged?: boolean};
      try {
        result = await runTool(call.function.name, args, {projectId, sessionId});
      } catch (error) {
        result = {ok: false, content: `Tool threw: ${String(error)}`};
      }

      if (result.branchChanged) {
        yield {type: 'branch', text: 'Framer moved these edits onto a new branch.'};
      }

      yield {
        type: 'tool_result',
        id: call.id,
        ok: result.ok,
        preview: result.content.slice(0, 600),
      };

      messages.push({role: 'tool', tool_call_id: call.id, content: clip(result.content)});
    }
  }

  yield {type: 'error', text: `Stopped after ${MAX_STEPS} steps without finishing. Try a narrower request.`};
}
