import {createSession} from '@/lib/framer';
import {isLocalRequest, refuseRemote} from '@/lib/localOnly';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Open a session against a project.
 *
 * Also regenerates that project's guidance bundle on disk, which the agent
 * reads through its `read_context` tool — so this is the step that makes the
 * agent aware of the project's pages, components, CMS and styles.
 */
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return refuseRemote();

  const {projectId} = (await request.json().catch(() => ({}))) as {projectId?: string};
  if (typeof projectId !== 'string' || !projectId.trim()) {
    return new Response(JSON.stringify({error: 'projectId is required.'}), {
      status: 400,
      headers: {'Content-Type': 'application/json'},
    });
  }

  try {
    const sessionId = await createSession(projectId.trim());
    return new Response(JSON.stringify({sessionId}), {
      headers: {'Content-Type': 'application/json'},
    });
  } catch (error) {
    return new Response(JSON.stringify({error: (error as Error).message}), {
      status: 502,
      headers: {'Content-Type': 'application/json'},
    });
  }
}
