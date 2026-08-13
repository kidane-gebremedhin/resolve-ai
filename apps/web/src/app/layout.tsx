import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ToasterHost } from '@/components/toaster-host';
import { ThemeProvider } from '@/components/theme-provider';
import { AttributionCapture } from '@/components/marketing/attribution-capture';
import { parseTheme, type Theme } from '@/lib/theme';
import { APP_NAME, APP_TAGLINE } from '@/lib/app-config';
import { sansFont, displayFont } from './fonts';
import { API_INTERNAL_URL } from '@/lib/app-urls';
import './globals.css';

// Global app font is a platform setting (admin → Settings → Theming). Read it
// from the public theming endpoint server-side; falls back to the Inter default
// when unreachable so the app always renders.
// NOTE: this runs on the server, so it must use API_INTERNAL_URL (the api service
// over the compose network) — the public API_URL is `localhost:4000`, which from
// inside the web container points at the web container itself, not the API.
async function getTheming(): Promise<{ fontSans?: string; fontDisplay?: string }> {
  try {
    // no-store: always read the current admin-set font at request time. With
    // ISR caching (revalidate) a production build baked the build-time font into
    // static pages and a later change never showed. This opts routes into
    // dynamic rendering — acceptable for a global, admin-controlled font.
    const res = await fetch(`${API_INTERNAL_URL}/public/theming`, {
      cache: 'no-store',
    });
    if (!res.ok) return {};
    return (await res.json()) as { fontSans?: string; fontDisplay?: string };
  } catch {
    return {};
  }
}

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} | ${APP_TAGLINE}`,
    template: `%s | ${APP_NAME}`,
  },
  description: `${APP_NAME}: AI agent, unified inbox and analytics that resolve 68% of tickets automatically.`,
  openGraph: {
    title: `${APP_NAME} | ${APP_TAGLINE}`,
    description: `${APP_NAME}: AI agent, unified inbox and analytics that resolve 68% of tickets automatically.`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: `${APP_NAME} | ${APP_TAGLINE}`,
    description: `${APP_NAME}: AI agent, unified inbox and analytics that resolve 68% of tickets automatically.`,
  },
};

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
      <head>
        {/* Blocking script — runs synchronously before first paint so dark-mode
            preference from localStorage/system never causes a white flash.       */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';}var d=document.documentElement;d.classList.toggle('dark',t==='dark');d.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <AttributionCapture />
        <ThemeProvider initialTheme={initialTheme}>
          {children}
          {/* Global toast host. Action failures (login rejected, save failed)
              surface here instead of as text wedged under a form. `richColors`
              gives error/success their own palette; `closeButton` matters
              because an error people need to read shouldn't time out on them. */}
          <ToasterHost />
        </ThemeProvider>
      </body>
    </html>
  );
}
