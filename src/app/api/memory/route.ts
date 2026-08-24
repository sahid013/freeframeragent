import {clearMemory, readMemory} from '@/lib/projectMemory';
import {isLocalRequest, refuseRemote} from '@/lib/localOnly';

export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

/** What the agent has learned about a project and kept. */
export async function GET(request: Request) {
  if (!isLocalRequest(request)) return refuseRemote();

  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!projectId) return json({error: 'projectId is required.'}, 400);

  return json({notes: await readMemory(projectId)});
}

/** Wipe it — use when the project changed enough that old findings mislead. */
export async function DELETE(request: Request) {
  if (!isLocalRequest(request)) return refuseRemote();

  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!projectId) return json({error: 'projectId is required.'}, 400);

  await clearMemory(projectId);
  return json({notes: []});
}
