import {buildSystemPrompt, runAgent, type ApiMessage} from '@/lib/agentLoop';
import {
  loadConversation,
  resetConversation,
  saveConversation,
  trimConversation,
} from '@/lib/conversations';
import {ALLOWED_MODELS, DEFAULT_AGENT_MODEL} from '@/lib/models';
import {isLocalRequest, refuseRemote} from '@/lib/localOnly';

export const runtime = 'nodejs';
export const maxDuration = 800;

/**
 * Streams the agent's work as newline-delimited JSON events.
 *
 * The transcript — tool calls and their results included — is kept server-side
 * per session, so a follow-up continues from what the agent already discovered
 * instead of rebuilding its understanding from the visible text alone.
 */
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return refuseRemote();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({error: 'OPENROUTER_API_KEY is not set.'}), {
      status: 500,
      headers: {'Content-Type': 'application/json'},
    });
  }

  const body = (await request.json().catch(() => ({}))) as {
    projectId?: string;
    sessionId?: string;
    model?: string;
    message?: string;
    reset?: boolean;
  };

  const {projectId, sessionId, message} = body;
  if (!projectId || !sessionId) {
    return new Response(JSON.stringify({error: 'projectId and sessionId are required.'}), {
      status: 400,
      headers: {'Content-Type': 'application/json'},
    });
  }

  if (typeof message !== 'string' || !message.trim()) {
    return new Response(JSON.stringify({error: 'message must be a non-empty string.'}), {
      status: 400,
      headers: {'Content-Type': 'application/json'},
    });
  }

  const model =
    body.model && (ALLOWED_MODELS as readonly string[]).includes(body.model)
      ? body.model
      : DEFAULT_AGENT_MODEL;

  if (body.reset) resetConversation(projectId, sessionId);

  // Rebuild the system message each turn so notes saved last turn are in play now.
  const system: ApiMessage = {role: 'system', content: await buildSystemPrompt(projectId)};
  const prior = loadConversation(projectId, sessionId);
  const conversation: ApiMessage[] =
    prior.length > 0 ? [system, ...prior.slice(1)] : [system];

  conversation.push({role: 'user', content: message});

  const working = trimConversation(conversation);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        for await (const event of runAgent({
          projectId,
          sessionId,
          model,
          apiKey,
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
          signal: request.signal,
          conversation: working,
        })) {
          send(event);
        }
      } catch (error) {
        if (!request.signal.aborted) {
          send({type: 'error', text: (error as Error).message ?? 'Agent failed.'});
        }
      } finally {
        // Persist whatever was learned, even on abort or failure.
        saveConversation(projectId, sessionId, working);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
