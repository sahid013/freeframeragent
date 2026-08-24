import {execCode} from '@/lib/framer';

/**
 * Layer-tree reads for the element picker.
 *
 * Framer's headless relay connects to the project document, not to the editor
 * window, so there is no "what the user just clicked" to read. The picker walks
 * the tree here instead, and mirrors each pick back into the editor with
 * `setSelection` so the user can see what they targeted.
 */

const MARKER = '<<<FRAMER_JSON>>>';

export type TreeNode = {
  id: string;
  name: string;
  type: string;
  childCount: number;
  text?: string;
};

export type TreeLevel = {
  id: string;
  name: string;
  type: string;
  children: TreeNode[];
};

/** Run a snippet that prints one marked JSON line, and parse it back. */
async function execJson<T>(sessionId: string, body: string): Promise<T> {
  const result = await execCode(sessionId, body);
  const line = result.output.split('\n').find((l) => l.includes(MARKER));

  if (!line) {
    throw new Error(result.output.slice(0, 400) || 'No result from Framer.');
  }

  return JSON.parse(line.slice(line.indexOf(MARKER) + MARKER.length)) as T;
}

const DESCRIBE_CHILDREN = `
function describe(child) {
  const kids = Array.isArray(child.children) ? child.children.length : 0;
  let text;
  try {
    const inner = typeof getInnerText === 'function' ? getInnerText(child) : undefined;
    if (inner) text = String(inner).replace(/\\s+/g, ' ').trim().slice(0, 80);
  } catch {}
  return {id: child.id, name: child.name ?? child.type, type: child.type, childCount: kids, text};
}
`.trim();

/** Top level of the picker: the project's pages. */
export async function listPages(sessionId: string): Promise<TreeNode[]> {
  return execJson<TreeNode[]>(
    sessionId,
    `
const pages = await framer.agent.getNodesOfTypes({types: ['WebPageNode']});
const out = pages.map(p => ({id: p.id, name: p.name ?? p.id, type: p.type, childCount: 1}));
console.log('${MARKER}' + JSON.stringify(out));
`.trim(),
  );
}

/** One level down from a node. */
export async function listChildren(sessionId: string, nodeId: string): Promise<TreeLevel> {
  return execJson<TreeLevel>(
    sessionId,
    `
${DESCRIBE_CHILDREN}
const node = await framer.agent.serialize({id: ${JSON.stringify(nodeId)}});
const children = Array.isArray(node.children) ? node.children.map(describe) : [];
console.log('${MARKER}' + JSON.stringify({
  id: node.id,
  name: node.name ?? node.type,
  type: node.type,
  children,
}));
`.trim(),
  );
}

export type SelectionDetail = {
  id: string;
  name: string;
  type: string;
  /** Serialized node, trimmed to stay affordable in the prompt. */
  snippet: string;
  highlighted: boolean;
};

/**
 * Attach a node as prompt context, and select it in the Framer editor so the
 * user can confirm they picked the right layer.
 */
export async function describeSelection(
  sessionId: string,
  nodeId: string,
): Promise<SelectionDetail> {
  return execJson<SelectionDetail>(
    sessionId,
    `
const id = ${JSON.stringify(nodeId)};
const node = await framer.agent.serialize({id});
let highlighted = false;
try { await framer.setSelection(id); highlighted = true; } catch {}
const full = JSON.stringify(node);
console.log('${MARKER}' + JSON.stringify({
  id: node.id,
  name: node.name ?? node.type,
  type: node.type,
  highlighted,
  snippet: full.length > 6000 ? full.slice(0, 6000) + '…(truncated)' : full,
}));
`.trim(),
  );
}
