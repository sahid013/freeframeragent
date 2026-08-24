/**
 * Models the console will drive the agent with.
 *
 * Editing a Framer project is a tool-calling loop: several round trips, each
 * carrying the project context. Model choice matters more for reliability here
 * than it does for a plain chat widget — weaker models tend to skip the
 * read-before-edit step or malform applyChanges payloads.
 */
export const ALLOWED_MODELS = [
  'stealth/ox-alpha',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash',
] as const;

export type AgentModel = (typeof ALLOWED_MODELS)[number];

/**
 * Ox Alpha is an unattributed stealth model OpenRouter is previewing at $0 with
 * a 1M context and tool support, so the loop runs without credits. Two catches:
 * the free window is temporary, and stealth traffic is used as training/eval
 * signal — switch to Sonnet for anything confidential.
 */
export const DEFAULT_AGENT_MODEL: AgentModel = 'stealth/ox-alpha';

export const MODEL_LABELS: Record<AgentModel, string> = {
  'stealth/ox-alpha': 'Ox Alpha (free)',
  'anthropic/claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'anthropic/claude-haiku-4.5': 'Claude Haiku 4.5',
  'openai/gpt-4o': 'GPT-4o',
  'openai/gpt-4o-mini': 'GPT-4o mini',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
};
