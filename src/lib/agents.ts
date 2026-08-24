/**
 * Agent presets.
 *
 * System prompts live here — on the server — and are selected by id. The
 * browser (and therefore the Framer component) can pick *which* agent to talk
 * to, but can never hand us a system prompt of its own. That keeps an embedded
 * public widget from being repurposed as a free, arbitrary LLM endpoint.
 */

export type AgentId = keyof typeof AGENTS;

export type Agent = {
  /** Shown in the composer + empty state. */
  name: string;
  /** Assistant display name beside each reply. */
  handle: string;
  system: string;
  greeting: string;
  placeholder: string;
  /** Overrides DEFAULT_MODEL when the caller doesn't pick one. */
  model?: string;
  suggestions?: string[];
};

export const AGENTS = {
  assistant: {
    name: 'Assistant',
    handle: 'Assistant',
    system:
      'You are a helpful, concise assistant embedded on a website. ' +
      'Answer in plain language. Prefer short paragraphs and bullet lists. ' +
      'Use markdown for structure. If you do not know something, say so.',
    greeting: 'Ask me anything',
    placeholder: 'Ask a question…',
    suggestions: ['What can you help me with?', 'Summarize this site for me'],
  },
  support: {
    name: 'Support',
    handle: 'Support',
    system:
      'You are a friendly customer support agent. Be warm, direct, and brief. ' +
      'Ask one clarifying question when a request is ambiguous rather than ' +
      'guessing. Never invent policies, prices, or delivery dates — if you are ' +
      'not certain, say you will hand the conversation to a human.',
    greeting: 'How can we help?',
    placeholder: 'Describe your issue…',
    suggestions: ['I need help with my order', 'How do refunds work?'],
  },
  sales: {
    name: 'Sales',
    handle: 'Sales',
    system:
      'You are a product specialist helping a visitor decide whether this ' +
      'product fits their needs. Lead with the visitor’s problem, not the ' +
      'feature list. Keep replies under 120 words. End with one useful ' +
      'follow-up question. Never fabricate pricing.',
    greeting: 'Let’s find the right fit',
    placeholder: 'What are you trying to build?',
    suggestions: ['What does this cost?', 'How is this different?'],
  },
} as const satisfies Record<string, Agent>;

export const DEFAULT_AGENT: AgentId = 'assistant';

/**
 * Models the endpoint will proxy to. An allowlist rather than a passthrough so
 * a public embed can't be pointed at an expensive model by editing a URL.
 */
export const ALLOWED_MODELS = [
  'stealth/ox-alpha',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.3-70b-instruct',
] as const;

/**
 * Zero-cost, so the widget runs without credits.
 *
 * Worth knowing for a public embed: Ox Alpha is free because stealth traffic
 * becomes training/eval signal for an undisclosed lab — and on this endpoint
 * that traffic is your *visitors'* messages, not yours. Switch to
 * 'openai/gpt-4o-mini' if the widget will handle anything personal.
 */
export const DEFAULT_MODEL: (typeof ALLOWED_MODELS)[number] = 'stealth/ox-alpha';

export function resolveAgent(id: string | null | undefined): Agent & {id: AgentId} {
  const key = (id && id in AGENTS ? id : DEFAULT_AGENT) as AgentId;
  return {...AGENTS[key], id: key};
}

export function resolveModel(model: string | null | undefined, agent: Agent): string {
  if (model && (ALLOWED_MODELS as readonly string[]).includes(model)) return model;
  return agent.model ?? DEFAULT_MODEL;
}
