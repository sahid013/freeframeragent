import {resolveAgent, resolveModel} from '@/lib/agents';

/**
 * OpenRouter proxy.
 *
 * The API key never reaches the browser. Framer (and anything else) talks to
 * this route; only this route talks to OpenRouter.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MAX_MESSAGES = 40;
const MAX_CHARS_PER_MESSAGE = 8_000;

/**
 * Cap the reply length. Beyond keeping answers snappy, OpenRouter reserves the
 * full max_tokens against your balance up front — leaving it unset makes a
 * model like gpt-4o reserve 16k and fail with a 402 on a small balance.
 */
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 1024);
/** 0 (or a non-number) drops the cap — safe on zero-cost models. */
const MAX_TOKENS_FIELD =
  Number.isFinite(MAX_TOKENS) && MAX_TOKENS > 0 ? {max_tokens: MAX_TOKENS} : {};

/** Requests per IP per window. In-memory: per instance, resets on cold start. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, {count: number; resetAt: number}>();

type Role = 'user' | 'assistant';
type ClientMessage = {role: Role; content: string};

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Echo the caller's origin when it's allowed. `ALLOWED_ORIGINS` unset means
 * "same-origin embed only" in production, but stays open in development so the
 * Framer canvas can hit a local tunnel without extra config.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins();
  const open = allowed.length === 0 && process.env.NODE_ENV !== 'production';

  if (!origin) return {};
  if (!open && !allowed.includes(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, {count: 1, resetAt: now + RATE_WINDOW_MS});
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const {role, content} = value as Record<string, unknown>;
  return (role === 'user' || role === 'assistant') && typeof content === 'string';
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json', ...headers},
  });
}

export async function OPTIONS(request: Request) {
  return new Response(null, {status: 204, headers: corsHeaders(request)});
}

export async function POST(request: Request) {
  const cors = corsHeaders(request);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json({error: 'OPENROUTER_API_KEY is not set on the server.'}, 500, cors);
  }

  if (rateLimited(clientIp(request))) {
    return json({error: 'Too many requests. Give it a minute.'}, 429, cors);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({error: 'Body must be JSON.'}, 400, cors);
  }

  const {messages, agent: agentId, model: requestedModel} = (body ?? {}) as {
    messages?: unknown;
    agent?: unknown;
    model?: unknown;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({error: '`messages` must be a non-empty array.'}, 400, cors);
  }
  if (!messages.every(isClientMessage)) {
    return json(
      {error: 'Each message needs a `role` of user|assistant and string `content`.'},
      400,
      cors,
    );
  }

  const agent = resolveAgent(typeof agentId === 'string' ? agentId : null);
  const model = resolveModel(typeof requestedModel === 'string' ? requestedModel : null, agent);

  // Trim to the most recent turns so a long-lived widget can't grow unbounded.
  const trimmed = (messages as ClientMessage[])
    .slice(-MAX_MESSAGES)
    .map((m) => ({role: m.role, content: m.content.slice(0, MAX_CHARS_PER_MESSAGE)}));

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': site,
        'X-Title': process.env.SITE_NAME ?? 'Framer Agent',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        ...MAX_TOKENS_FIELD,
        temperature: 0.6,
        messages: [{role: 'system', content: agent.system}, ...trimmed],
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, {status: 499, headers: cors});
    return json({error: `Could not reach OpenRouter: ${String(error)}`}, 502, cors);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return json(
      {error: `OpenRouter returned ${upstream.status}.`, detail: detail.slice(0, 500)},
      upstream.status,
      cors,
    );
  }

  // Pass the SSE stream straight through; the client parses OpenAI-style chunks.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Model': model,
      ...cors,
    },
  });
}
