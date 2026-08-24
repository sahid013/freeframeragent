import {describeSelection} from '@/lib/framerTree';
import {isLocalRequest, refuseRemote} from '@/lib/localOnly';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Attach a layer as prompt context and highlight it in the Framer editor. */
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return refuseRemote();

  const {sessionId, nodeId} = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    nodeId?: string;
  };

  if (!sessionId || !nodeId) {
    return new Response(JSON.stringify({error: 'sessionId and nodeId are required.'}), {
      status: 400,
      headers: {'Content-Type': 'application/json'},
    });
  }

  try {
    return new Response(JSON.stringify({selection: await describeSelection(sessionId, nodeId)}), {
      headers: {'Content-Type': 'application/json'},
    });
  } catch (error) {
    return new Response(JSON.stringify({error: (error as Error).message}), {
      status: 502,
      headers: {'Content-Type': 'application/json'},
    });
  }
}
