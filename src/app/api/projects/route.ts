import {authProject, listProjects} from '@/lib/framer';
import {isLocalRequest, refuseRemote} from '@/lib/localOnly';

export const runtime = 'nodejs';
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

/** Projects already authorized on this machine. */
export async function GET(request: Request) {
  if (!isLocalRequest(request)) return refuseRemote();

  try {
    return json({projects: await listProjects()});
  } catch (error) {
    return json({error: (error as Error).message}, 500);
  }
}

/**
 * Connect a new project. Framer runs a browser approval flow, so this blocks
 * until the user approves in the tab that opens (or it times out).
 */
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return refuseRemote();

  const {project} = (await request.json().catch(() => ({}))) as {project?: string};
  if (typeof project !== 'string' || !project.trim()) {
    return json({error: 'Paste a Framer project URL or ID.'}, 400);
  }

  try {
    await authProject(project.trim());
    return json({projects: await listProjects()});
  } catch (error) {
    return json({error: (error as Error).message}, 502);
  }
}
