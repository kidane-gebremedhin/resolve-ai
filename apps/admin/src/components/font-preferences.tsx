'use client';

// Global app font picker. Two searchable comboboxes (body + heading) list every
// available font; each option renders in its own font so the admin can see it,
// and a live preview panel re-renders instantly in the selected fonts before
// saving. The choice is saved to PlatformSetting.theming and applies across /app,
// the public marketing pages, the widget, and this admin portal.

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
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

/** Searchable font picker; each option previews in its own font. */
function FontCombobox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: FontOption[];
}) {
  const [open, setOpen] = useState(false);
  const selected = byValue(options, value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="mt-3 w-full justify-between font-normal"
        >
          <span className={selected.className} style={{ fontFamily: selected.fontFamily }}>
            {selected.label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fonts…" />
          <CommandList>
            <CommandEmpty>No font found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <span className={o.className} style={{ fontFamily: o.fontFamily }}>
                    {o.label}
                  </span>
                  <Check
                    className={`ml-auto h-4 w-4 ${value === o.value ? 'opacity-100' : 'opacity-0'}`}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
          <FontCombobox
            value={fontSans}
            onChange={(v) => {
              setFontSans(v);
              setSaved(false);
            }}
            options={sans}
          />
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
          <FontCombobox
            value={fontDisplay}
            onChange={(v) => {
              setFontDisplay(v);
              setSaved(false);
            }}
            options={display}
          />
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
        {saved ? (
          <span className="text-xs text-emerald-600">Saved — applies on next page load.</span>
        ) : null}
      </div>
    </div>
  );
}
