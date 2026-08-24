import {headers} from 'next/headers';
import {Console} from '@/components/Console';
import {Providers} from '@/app/providers';
import {Banner} from '@astryxdesign/core/Banner';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Link} from '@astryxdesign/core/Link';
import {Code} from '@astryxdesign/core/Code';
import {VStack} from '@astryxdesign/core/Stack';

export const dynamic = 'force-dynamic';

function isLocalHost(host: string): boolean {
  const name = host.split(':')[0].toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
}

export default async function Home() {
  const host = (await headers()).get('host') ?? '';

  /**
   * The console drives a relay on 127.0.0.1 and reads credentials from the
   * user's home directory, so it only functions on the machine running it. Say
   * that plainly when deployed, rather than rendering a console whose every
   * request comes back 403.
   */
  if (!isLocalHost(host)) {
    return (
      <Providers>
        <VStack gap={4} padding={6} maxWidth={640} style={{margin: '0 auto'}}>
          <Heading level={1}>Framer Agent Console</Heading>

          <Banner
            status="info"
            title="This console runs on your own machine"
            description="It drives the Framer relay on 127.0.0.1 and reads credentials from your home directory — neither exists on a server, so its API routes refuse non-local requests by design."
          />

          <Text>
            Clone the repo and run <Code>npm run dev</Code>, then open{' '}
            <Code>http://localhost:3000</Code>.
          </Text>

          <Text>
            What <em>does</em> work on this deployment is the chat widget:{' '}
            <Link href="/embed">/embed</Link>, served by <Code>/api/chat</Code>. That is the part
            you embed on a published Framer site. It needs <Code>OPENROUTER_API_KEY</Code> set in
            your Vercel project settings.
          </Text>
        </VStack>
      </Providers>
    );
  }

  return (
    <Providers>
      <Console />
    </Providers>
  );
}
