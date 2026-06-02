import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Inter, Inter_Tight } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { parseTheme, type Theme } from '@/lib/theme';
import { APP_NAME, APP_TAGLINE } from '@/lib/app-config';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const interTight = Inter_Tight({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter-tight',
});

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s — ${APP_NAME}`,
  },
  description: `${APP_NAME} — AI agent, unified inbox and analytics that resolve 68% of tickets automatically.`,
  openGraph: {
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: `${APP_NAME} — AI agent, unified inbox and analytics that resolve 68% of tickets automatically.`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: `${APP_NAME} — AI agent, unified inbox and analytics that resolve 68% of tickets automatically.`,
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieTheme = parseTheme(cookieStore.get('theme')?.value);
  const initialTheme: Theme = cookieTheme ?? 'light';

  return (
    <html
      lang="en"
      className={`${inter.variable} ${interTight.variable}${initialTheme === 'dark' ? ' dark' : ''}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <ThemeProvider initialTheme={initialTheme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
