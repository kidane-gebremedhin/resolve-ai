'use client';

// Global app font picker. Two dropdowns (body + heading) list every available
// font; a live preview panel re-renders instantly in the selected fonts so the
// admin can see the change before saving. The choice is saved to
// PlatformSetting.theming and applies across /app, public pages, and this
// admin portal.

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@csb/ui';
import { clientApi, ApiError } from '@/lib/api';

export type FontOption = {
  value: string;
  label: string;
  /** next/font className — applying it ensures the font is bundled + loaded. */
  className: string;
  /** Actual font-family string to render the sample in this font. */
  fontFamily: string;
};

const SAMPLE =
  'The quick brown fox jumps over the lazy dog. 0123456789 — Pack my box with five dozen liquor jugs.';

function byValue(options: FontOption[], value: string) {
  return options.find((o) => o.value === value) ?? options[0];
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

  const sansOpt = useMemo(() => byValue(sans, fontSans), [sans, fontSans]);
  const displayOpt = useMemo(() => byValue(display, fontDisplay), [display, fontDisplay]);

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
      {/* Each picker sits on the left with a live sample, in the chosen font,
          aligned to its right — so the change is visible right beside the control. */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="sm:w-72 sm:shrink-0">
          <label className="font-display text-sm font-semibold">Body font</label>
          <p className="mt-0.5 text-xs text-muted-foreground">Paragraphs and UI text everywhere.</p>
          <Select
            value={fontSans}
            onValueChange={(v) => {
              setFontSans(v);
              setSaved(false);
            }}
          >
            <SelectTrigger className="mt-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {sans.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <span className={o.className} style={{ fontFamily: o.fontFamily }}>
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 rounded-xl border border-border bg-muted/20 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Sample · {sansOpt.label}
          </p>
          <p
            className={`${sansOpt.className} mt-2 text-base leading-relaxed text-foreground`}
            style={{ fontFamily: sansOpt.fontFamily }}
          >
            {SAMPLE}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="sm:w-72 sm:shrink-0">
          <label className="font-display text-sm font-semibold">Heading font</label>
          <p className="mt-0.5 text-xs text-muted-foreground">Titles and display text.</p>
          <Select
            value={fontDisplay}
            onValueChange={(v) => {
              setFontDisplay(v);
              setSaved(false);
            }}
          >
            <SelectTrigger className="mt-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {display.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <span className={o.className} style={{ fontFamily: o.fontFamily }}>
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 rounded-xl border border-border bg-muted/20 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Sample · {displayOpt.label}
          </p>
          <h3
            className={`${displayOpt.className} mt-2 text-2xl font-semibold leading-tight text-foreground`}
            style={{ fontFamily: displayOpt.fontFamily }}
          >
            Your support, beautifully on brand
          </h3>
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
