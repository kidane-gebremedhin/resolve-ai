import { api, ApiError } from '@/lib/api';
import { FontPreferences, type FontOption } from '@/components/font-preferences';
import { BudgetLimitsForm } from '@/components/admin/budget-limits-form';
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

type BudgetEntry = {
  plan: 'pro' | 'business' | 'enterprise';
  orgMonthlyLimitUsd: number;
  websiteMonthlyLimitUsd: number;
};

type Settings = {
  theming?: { fontSans?: string; fontDisplay?: string };
  budgetLimits?: BudgetEntry[];
};

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

async function loadCurrent(): Promise<{
  fontSans: string;
  fontDisplay: string;
  budgetLimits: BudgetEntry[];
  error: string | null;
}> {
  try {
    const s = await api.get<Settings>('/admin/settings');
    return {
      fontSans: s?.theming?.fontSans ?? DEFAULT_SANS,
      fontDisplay: s?.theming?.fontDisplay ?? DEFAULT_DISPLAY,
      budgetLimits: s?.budgetLimits ?? [],
      error: null,
    };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return {
      fontSans: DEFAULT_SANS,
      fontDisplay: DEFAULT_DISPLAY,
      budgetLimits: [],
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
        Global platform configuration — fonts, budget limits, and more.
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
      <BudgetLimitsForm initial={current.budgetLimits} />
    </div>
  );
}
