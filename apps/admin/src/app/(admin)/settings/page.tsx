import { api, ApiError } from '@/lib/api';
import { FontPreferences, type FontOption } from '@/components/font-preferences';
import {
  SANS_FONTS,
  DISPLAY_FONTS,
  SANS_OPTIONS,
  DISPLAY_OPTIONS,
  DEFAULT_SANS,
  DEFAULT_DISPLAY,
  type SansKey,
  type DisplayKey,
} from '@/app/fonts';

type Theming = { theming?: { fontSans?: string; fontDisplay?: string } };

// Build the picker options with each font's className (so next/font bundles +
// loads it) and its actual font-family (so the sample renders in that font).
const SANS: FontOption[] = SANS_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  className: SANS_FONTS[o.value as SansKey].className,
  fontFamily: SANS_FONTS[o.value as SansKey].style.fontFamily,
}));
const DISPLAY: FontOption[] = DISPLAY_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  className: DISPLAY_FONTS[o.value as DisplayKey].className,
  fontFamily: DISPLAY_FONTS[o.value as DisplayKey].style.fontFamily,
}));

async function loadCurrent(): Promise<{ fontSans: string; fontDisplay: string; error: string | null }> {
  try {
    const s = await api.get<Theming>('/admin/settings');
    return {
      fontSans: s?.theming?.fontSans ?? DEFAULT_SANS,
      fontDisplay: s?.theming?.fontDisplay ?? DEFAULT_DISPLAY,
      error: null,
    };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // propagate the /logout redirect on 401/403
    return {
      fontSans: DEFAULT_SANS,
      fontDisplay: DEFAULT_DISPLAY,
      error: err.message,
    };
  }
}

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const current = await loadCurrent();
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">System Preferences</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Global app font — applied consistently across the dashboard, public pages, and this admin
        portal.
      </p>
      {current.error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {current.error}
        </div>
      ) : null}
      <FontPreferences
        sans={SANS}
        display={DISPLAY}
        current={{ fontSans: current.fontSans, fontDisplay: current.fontDisplay }}
      />
    </div>
  );
}
