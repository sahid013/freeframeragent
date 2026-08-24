import {AgentChat} from '@/components/AgentChat';
import {Providers, type ThemeMode} from '@/app/providers';
import {resolveAgent, resolveModel} from '@/lib/agents';

/**
 * The surface the Framer component iframes.
 *
 * Everything configurable from Framer arrives as a query param — but only
 * cosmetics and an agent *id*. The system prompt stays server-side (see
 * `src/lib/agents.ts`).
 */

export const dynamic = 'force-dynamic';

const MODES: ThemeMode[] = ['light', 'dark', 'system'];
const DENSITIES = ['compact', 'balanced', 'spacious'] as const;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EmbedPage({searchParams}: PageProps<'/embed'>) {
  const params = await searchParams;

  const agent = resolveAgent(first(params.agent));
  const model = resolveModel(first(params.model), agent);
  const mode = pick(first(params.mode), MODES, 'system');
  const density = pick(first(params.density), DENSITIES, 'balanced');
  const transparent = first(params.bg) === 'transparent';
  const avatar = first(params.avatar);

  const overrides = {
    greeting: first(params.greeting),
    placeholder: first(params.placeholder),
    name: first(params.name),
  };

  return (
    <Providers mode={mode}>
      {transparent ? <style>{'body{background:transparent}'}</style> : null}
      <main style={{display: 'flex', flexDirection: 'column', height: '100dvh'}}>
        <AgentChat
          agentId={agent.id}
          agent={{
            ...agent,
            name: overrides.name || agent.name,
            greeting: overrides.greeting || agent.greeting,
            placeholder: overrides.placeholder || agent.placeholder,
          }}
          model={model}
          density={density}
          showSuggestions={first(params.suggestions) !== 'off'}
          avatarSrc={avatar}
        />
      </main>
    </Providers>
  );
}
