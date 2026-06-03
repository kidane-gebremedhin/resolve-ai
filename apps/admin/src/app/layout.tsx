import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ThemeProvider } from '@/components/theme-provider';
import { parseTheme, type Theme } from '@/lib/theme';
import { sansFont, displayFont } from './fonts';
import { API_URL } from '@/lib/app-urls';
import './globals.css';

export const metadata: Metadata = {
  title: 'Platform Admin',
  description: 'System administration portal.',
};

// Global app font is a platform setting; read it from the public theming
// endpoint so the admin portal uses the same font as /app and public pages.
async function getTheming(): Promise<{ fontSans?: string; fontDisplay?: string }> {
  try {
    const res = await fetch(`${API_URL}/public/theming`, {
      next: { revalidate: 60, tags: ['platform-theming'] },
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
