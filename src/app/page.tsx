import {Console} from '@/components/Console';
import {Providers} from '@/app/providers';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <Providers>
      <Console />
    </Providers>
  );
}
