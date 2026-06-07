import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ThemeProvider } from '@/components/theme-provider';
import { parseTheme, type Theme } from '@/lib/theme';
import { sansFont, displayFont } from './fonts';
import { API_INTERNAL_URL } from '@/lib/app-urls';
import './globals.css';

export const metadata: Metadata = {
  title: 'Platform Admin',
  description: 'System administration portal.',
};

// Global app font is a platform setting; read it from the public theming
// endpoint so the admin portal uses the same font as /app and public pages.
// Server-side fetch → use API_INTERNAL_URL (compose network), not the public
// localhost API_URL which resolves to this container from inside it.
async function getTheming(): Promise<{ fontSans?: string; fontDisplay?: string }> {
  try {
    // no-store: always read the current admin-set font at request time (a cached
    // build baked the build-time font into static pages and never updated).
    const res = await fetch(`${API_INTERNAL_URL}/public/theming`, {
      cache: 'no-store',
    });
    if (!res.ok) return {};
    return (await res.json()) as { fontSans?: string; fontDisplay?: string };
  } catch {
    return {};
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieTheme = parseTheme(cookieStore.get('theme')?.value);
  const initialTheme: Theme = cookieTheme ?? 'light';

  const theming = await getTheming();
  const sans = sansFont(theming.fontSans);
  const display = displayFont(theming.fontDisplay);

  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable}${initialTheme === 'dark' ? ' dark' : ''}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <ThemeProvider initialTheme={initialTheme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
