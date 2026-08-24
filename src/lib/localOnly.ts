/**
 * These routes drive a local relay that can edit the user's real Framer
 * projects, so they must never answer a request from another machine.
 */
export function isLocalRequest(request: Request): boolean {
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export function refuseRemote(): Response {
  return new Response(
    JSON.stringify({error: 'This console only answers requests from localhost.'}),
    {status: 403, headers: {'Content-Type': 'application/json'}},
  );
}
