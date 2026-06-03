'use client';

// Global app font picker. Lists every available font with a live sample
// rendered in that font, and saves the choice to PlatformSetting.theming. The
// chosen font applies across /app, public pages, and this admin portal.

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@csb/ui';
import { clientApi, ApiError } from '@/lib/api';

export type FontOption = {
  value: string;
  label: string;
  /** next/font className — applying it ensures the font is bundled + loaded. */
  className: string;
  /** Actual font-family string to render the sample in this font. */
  fontFamily: string;
};

const SAMPLE = 'The quick brown fox jumps over the lazy dog';

function FontCard({
  option,
  selected,
  display,
  onSelect,
}: {
  option: FontOption;
  selected: boolean;
  display: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col items-start rounded-xl border p-4 text-left transition ${
        selected ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:bg-muted/40'
      }`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-medium">{option.label}</span>
        {selected ? <Check className="h-4 w-4" /> : null}
      </div>
      <span
        className={`${option.className} mt-2 ${display ? 'text-2xl font-semibold' : 'text-base'} leading-snug text-foreground`}
        style={{ fontFamily: option.fontFamily }}
      >
        {display ? 'Heading sample' : SAMPLE}
      </span>
      {!display ? (
        <span className={`${option.className} mt-1 text-xs text-muted-foreground`} style={{ fontFamily: option.fontFamily }}>
          0123456789 — ABCDEFG abcdefg
        </span>
      ) : null}
    </button>
  );
}

export function FontPreferences({
  sans,
  display,
  current,
}: {
  sans: FontOption[];
  display: FontOption[];
  current: { fontSans: string; fontDisplay: string };
}) {
  const [fontSans, setFontSans] = useState(current.fontSans);
  const [fontDisplay, setFontDisplay] = useState(current.fontDisplay);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = fontSans !== current.fontSans || fontDisplay !== current.fontDisplay;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await clientApi.patch('/admin/settings', { theming: { fontSans, fontDisplay } });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 space-y-8">
      <section>
        <h2 className="font-display text-base font-semibold">Body font</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Used for paragraphs and UI text everywhere.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sans.map((o) => (
            <FontCard key={o.value} option={o} selected={fontSans === o.value} display={false} onSelect={() => { setFontSans(o.value); setSaved(false); }} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-base font-semibold">Heading font</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Used for titles and display text.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {display.map((o) => (
            <FontCard key={o.value} option={o} selected={fontDisplay === o.value} display onSelect={() => { setFontDisplay(o.value); setSaved(false); }} />
          ))}
        </div>
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save font
        </Button>
        {saved ? <span className="text-xs text-emerald-600">Saved — applies on next page load.</span> : null}
      </div>
    </div>
  );
}
