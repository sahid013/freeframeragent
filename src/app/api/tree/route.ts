import {listChildren, listPages} from '@/lib/framerTree';
import {isLocalRequest, refuseRemote} from '@/lib/localOnly';

export const runtime = 'nodejs';
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

/** Walk the project's layer tree one level at a time. */
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return refuseRemote();

  const {sessionId, nodeId} = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    nodeId?: string;
  };

  if (!sessionId) return json({error: 'sessionId is required.'}, 400);

  try {
    if (!nodeId) return json({level: {id: '', name: 'Pages', type: 'root', children: await listPages(sessionId)}});
    return json({level: await listChildren(sessionId, nodeId)});
  } catch (error) {
    return json({error: (error as Error).message}, 502);
  }
}
