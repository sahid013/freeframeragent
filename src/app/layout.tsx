import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Framer Agent',
  description: 'An OpenRouter-backed chat agent, styled with Astryx, embeddable in Framer.',
};

export default function RootLayout({children}: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
