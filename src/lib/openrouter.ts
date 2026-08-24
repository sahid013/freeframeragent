/**
 * OpenRouter calls with retry on transient upstream limits.
 *
 * Free stealth models run on a capacity pool shared by everyone using them, so
 * a 429 carrying `limit_source: upstream_provider_shared_pool` means "the pool
 * is busy right now", not "you did something wrong" — it clears on its own.
 * Retrying a few times turns most of those into a normal response instead of an
 * error in the user's face.
 */

const RETRY_DELAYS_MS = [1_000, 3_000, 7_000];

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      {once: true},
    );
  });
}

export type RetryNotice = {attempt: number; waitMs: number};

export async function fetchOpenRouter(
  url: string,
  init: RequestInit,
  {
    signal,
    onRetry,
  }: {signal: AbortSignal; onRetry?: (notice: RetryNotice) => void} = {
    signal: new AbortController().signal,
  },
): Promise<Response> {
  let last: Response | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(url, {...init, signal});

    // 429 is the shared-pool case; 5xx is a transient upstream fault.
    if (response.status !== 429 && response.status < 500) return response;

    last = response;
    if (attempt === RETRY_DELAYS_MS.length) break;

    // Drain the body so the connection can be reused.
    await response.text().catch(() => '');

    const waitMs = RETRY_DELAYS_MS[attempt];
    onRetry?.({attempt: attempt + 1, waitMs});
    await sleep(waitMs, signal);
  }

  return last as Response;
}
