// Curated global-font registry. Each candidate is loaded via next/font (so it
// stays optimized/self-hosted) and assigned to one of the two CSS-variable
// "slots" the rest of the app already reads:
//   --font-inter        → body/sans slot (globals.css maps it to --font-sans)
//   --font-inter-tight  → heading/display slot (→ --font-display, and .ns-theme)
// The root layout applies exactly one sans + one display className, so only one
// font populates each slot at a time. Add a font here + to the admin enum
// (apps/api/src/routes/admin.routes.ts) to offer it. All chosen fonts are
// variable fonts, so no explicit weights are needed.
import { Inter, Inter_Tight, Open_Sans, Montserrat, Lora } from 'next/font/google';

// --- Sans slot (variable: --font-inter) ---
const interSans = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const openSans = Open_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const montserratSans = Montserrat({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

// --- Display slot (variable: --font-inter-tight) ---
const interTight = Inter_Tight({ subsets: ['latin'], display: 'swap', variable: '--font-inter-tight' });
const lora = Lora({ subsets: ['latin'], display: 'swap', variable: '--font-inter-tight' });
const montserratDisplay = Montserrat({ subsets: ['latin'], display: 'swap', variable: '--font-inter-tight' });

export const SANS_FONTS = {
  inter: interSans,
  'open-sans': openSans,
  montserrat: montserratSans,
} as const;

export const DISPLAY_FONTS = {
  'inter-tight': interTight,
  lora,
  montserrat: montserratDisplay,
} as const;

export type SansKey = keyof typeof SANS_FONTS;
export type DisplayKey = keyof typeof DISPLAY_FONTS;

export const DEFAULT_SANS: SansKey = 'inter';
export const DEFAULT_DISPLAY: DisplayKey = 'inter-tight';

export function sansFont(key?: string | null) {
  return SANS_FONTS[(key as SansKey)] ?? SANS_FONTS[DEFAULT_SANS];
}
export function displayFont(key?: string | null) {
  return DISPLAY_FONTS[(key as DisplayKey)] ?? DISPLAY_FONTS[DEFAULT_DISPLAY];
}

// For the admin select UI (label + value).
export const SANS_OPTIONS: { value: SansKey; label: string }[] = [
  { value: 'inter', label: 'Inter' },
  { value: 'open-sans', label: 'Open Sans' },
  { value: 'montserrat', label: 'Montserrat' },
];
export const DISPLAY_OPTIONS: { value: DisplayKey; label: string }[] = [
  { value: 'inter-tight', label: 'Inter Tight' },
  { value: 'lora', label: 'Lora (serif)' },
  { value: 'montserrat', label: 'Montserrat' },
];
