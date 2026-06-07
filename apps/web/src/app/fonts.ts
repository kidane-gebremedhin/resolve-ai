// Curated global-font registry — vendored locally via @fontsource (self-hosted
// woff2 files in node_modules), loaded with next/font/local so the BUILD never
// fetches from Google Fonts (which made the Docker/Coolify build flaky).
//
// Every font is offered for BOTH the body and the heading, so the admin's two
// selects (System Preferences) show the SAME list. next/font emits a separate
// @font-face/variable per call and only loads when its `.variable` className is
// applied, so each font is declared twice — once for the body slot
// (variable: --font-inter → globals.css maps to --font-sans) and once for the
// heading slot (variable: --font-inter-tight → --font-display, and .ns-theme).
//
// To add a font: `pnpm add --filter @csb/{web,admin} @fontsource[-variable]/<name>`,
// add a `<name>Sans` + `<name>Display` entry + key here AND in
// apps/admin/src/app/fonts.ts, and the admin enum (apps/api/src/routes/admin.routes.ts).
// next/font/local needs string LITERAL src paths. Keep this file identical to admin.
import localFont from 'next/font/local';

// ============================ Body slot (--font-inter) ============================
const interSans = localFont({ src: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter' });
const interTightSans = localFont({ src: '../../node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter' });
const geistSans = localFont({ src: '../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter' });
const dmSansSans = localFont({ src: '../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2', weight: '100 1000', display: 'swap', variable: '--font-inter' });
const plusJakartaSansSans = localFont({ src: '../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2', weight: '200 800', display: 'swap', variable: '--font-inter' });
const manropeSans = localFont({ src: '../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', weight: '200 800', display: 'swap', variable: '--font-inter' });
const soraSans = localFont({ src: '../../node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2', weight: '100 800', display: 'swap', variable: '--font-inter' });
const spaceGroteskSans = localFont({ src: '../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', weight: '300 700', display: 'swap', variable: '--font-inter' });
const ibmPlexSansSans = localFont({ src: [
  { path: '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
  { path: '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  { path: '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
], display: 'swap', variable: '--font-inter' });
const robotoSans = localFont({ src: [
  { path: '../../node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/roboto/files/roboto-latin-500-normal.woff2', weight: '500', style: 'normal' },
  { path: '../../node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff2', weight: '700', style: 'normal' },
], display: 'swap', variable: '--font-inter' });
const openSansSans = localFont({ src: '../../node_modules/@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2', weight: '300 800', display: 'swap', variable: '--font-inter' });
const latoSans = localFont({ src: [
  { path: '../../node_modules/@fontsource/lato/files/lato-latin-300-normal.woff2', weight: '300', style: 'normal' },
  { path: '../../node_modules/@fontsource/lato/files/lato-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/lato/files/lato-latin-700-normal.woff2', weight: '700', style: 'normal' },
], display: 'swap', variable: '--font-inter' });
const montserratSans = localFont({ src: '../../node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter' });
const poppinsSans = localFont({ src: [
  { path: '../../node_modules/@fontsource/poppins/files/poppins-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/poppins/files/poppins-latin-500-normal.woff2', weight: '500', style: 'normal' },
  { path: '../../node_modules/@fontsource/poppins/files/poppins-latin-600-normal.woff2', weight: '600', style: 'normal' },
  { path: '../../node_modules/@fontsource/poppins/files/poppins-latin-700-normal.woff2', weight: '700', style: 'normal' },
], display: 'swap', variable: '--font-inter' });
const nunitoSans = localFont({ src: '../../node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2', weight: '200 1000', display: 'swap', variable: '--font-inter' });
const workSansSans = localFont({ src: '../../node_modules/@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter' });
const loraSans = localFont({ src: '../../node_modules/@fontsource-variable/lora/files/lora-latin-wght-normal.woff2', weight: '400 700', display: 'swap', variable: '--font-inter' });
const merriweatherSans = localFont({ src: [
  { path: '../../node_modules/@fontsource/merriweather/files/merriweather-latin-300-normal.woff2', weight: '300', style: 'normal' },
  { path: '../../node_modules/@fontsource/merriweather/files/merriweather-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/merriweather/files/merriweather-latin-700-normal.woff2', weight: '700', style: 'normal' },
  { path: '../../node_modules/@fontsource/merriweather/files/merriweather-latin-900-normal.woff2', weight: '900', style: 'normal' },
], display: 'swap', variable: '--font-inter' });
const playfairSans = localFont({ src: '../../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2', weight: '400 900', display: 'swap', variable: '--font-inter' });
const oswaldSans = localFont({ src: '../../node_modules/@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2', weight: '200 700', display: 'swap', variable: '--font-inter' });

// ========================== Heading slot (--font-inter-tight) ==========================
const interDisplay = localFont({ src: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter-tight' });
const interTightDisplay = localFont({ src: '../../node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter-tight' });
const geistDisplay = localFont({ src: '../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter-tight' });
const dmSansDisplay = localFont({ src: '../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2', weight: '100 1000', display: 'swap', variable: '--font-inter-tight' });
const plusJakartaSansDisplay = localFont({ src: '../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2', weight: '200 800', display: 'swap', variable: '--font-inter-tight' });
const manropeDisplay = localFont({ src: '../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', weight: '200 800', display: 'swap', variable: '--font-inter-tight' });
const soraDisplay = localFont({ src: '../../node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2', weight: '100 800', display: 'swap', variable: '--font-inter-tight' });
const spaceGroteskDisplay = localFont({ src: '../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', weight: '300 700', display: 'swap', variable: '--font-inter-tight' });
const ibmPlexSansDisplay = localFont({ src: [
  { path: '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
  { path: '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  { path: '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
], display: 'swap', variable: '--font-inter-tight' });
const robotoDisplay = localFont({ src: [
  { path: '../../node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/roboto/files/roboto-latin-500-normal.woff2', weight: '500', style: 'normal' },
  { path: '../../node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff2', weight: '700', style: 'normal' },
], display: 'swap', variable: '--font-inter-tight' });
const openSansDisplay = localFont({ src: '../../node_modules/@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2', weight: '300 800', display: 'swap', variable: '--font-inter-tight' });
const latoDisplay = localFont({ src: [
  { path: '../../node_modules/@fontsource/lato/files/lato-latin-300-normal.woff2', weight: '300', style: 'normal' },
  { path: '../../node_modules/@fontsource/lato/files/lato-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/lato/files/lato-latin-700-normal.woff2', weight: '700', style: 'normal' },
], display: 'swap', variable: '--font-inter-tight' });
const montserratDisplay = localFont({ src: '../../node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter-tight' });
const poppinsDisplay = localFont({ src: [
  { path: '../../node_modules/@fontsource/poppins/files/poppins-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/poppins/files/poppins-latin-500-normal.woff2', weight: '500', style: 'normal' },
  { path: '../../node_modules/@fontsource/poppins/files/poppins-latin-600-normal.woff2', weight: '600', style: 'normal' },
  { path: '../../node_modules/@fontsource/poppins/files/poppins-latin-700-normal.woff2', weight: '700', style: 'normal' },
], display: 'swap', variable: '--font-inter-tight' });
const nunitoDisplay = localFont({ src: '../../node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2', weight: '200 1000', display: 'swap', variable: '--font-inter-tight' });
const workSansDisplay = localFont({ src: '../../node_modules/@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-inter-tight' });
const loraDisplay = localFont({ src: '../../node_modules/@fontsource-variable/lora/files/lora-latin-wght-normal.woff2', weight: '400 700', display: 'swap', variable: '--font-inter-tight' });
const merriweatherDisplay = localFont({ src: [
  { path: '../../node_modules/@fontsource/merriweather/files/merriweather-latin-300-normal.woff2', weight: '300', style: 'normal' },
  { path: '../../node_modules/@fontsource/merriweather/files/merriweather-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../../node_modules/@fontsource/merriweather/files/merriweather-latin-700-normal.woff2', weight: '700', style: 'normal' },
  { path: '../../node_modules/@fontsource/merriweather/files/merriweather-latin-900-normal.woff2', weight: '900', style: 'normal' },
], display: 'swap', variable: '--font-inter-tight' });
const playfairDisplay = localFont({ src: '../../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2', weight: '400 900', display: 'swap', variable: '--font-inter-tight' });
const oswaldDisplay = localFont({ src: '../../node_modules/@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2', weight: '200 700', display: 'swap', variable: '--font-inter-tight' });

// Same keys in both maps → the body and heading selects offer the same fonts.
export const SANS_FONTS = {
  inter: interSans,
  'inter-tight': interTightSans,
  geist: geistSans,
  'dm-sans': dmSansSans,
  'plus-jakarta-sans': plusJakartaSansSans,
  manrope: manropeSans,
  sora: soraSans,
  'space-grotesk': spaceGroteskSans,
  'ibm-plex-sans': ibmPlexSansSans,
  roboto: robotoSans,
  'open-sans': openSansSans,
  lato: latoSans,
  montserrat: montserratSans,
  poppins: poppinsSans,
  nunito: nunitoSans,
  'work-sans': workSansSans,
  lora: loraSans,
  merriweather: merriweatherSans,
  playfair: playfairSans,
  oswald: oswaldSans,
} as const;

export const DISPLAY_FONTS = {
  inter: interDisplay,
  'inter-tight': interTightDisplay,
  geist: geistDisplay,
  'dm-sans': dmSansDisplay,
  'plus-jakarta-sans': plusJakartaSansDisplay,
  manrope: manropeDisplay,
  sora: soraDisplay,
  'space-grotesk': spaceGroteskDisplay,
  'ibm-plex-sans': ibmPlexSansDisplay,
  roboto: robotoDisplay,
  'open-sans': openSansDisplay,
  lato: latoDisplay,
  montserrat: montserratDisplay,
  poppins: poppinsDisplay,
  nunito: nunitoDisplay,
  'work-sans': workSansDisplay,
  lora: loraDisplay,
  merriweather: merriweatherDisplay,
  playfair: playfairDisplay,
  oswald: oswaldDisplay,
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

// Body and heading offer the SAME options (popular website fonts). Serif fonts
// are noted so they're recognisable in the dropdown. Keep both lists identical.
export const FONT_OPTIONS: { value: SansKey; label: string }[] = [
  { value: 'inter', label: 'Inter' },
  { value: 'inter-tight', label: 'Inter Tight' },
  { value: 'geist', label: 'Geist' },
  { value: 'dm-sans', label: 'DM Sans' },
  { value: 'plus-jakarta-sans', label: 'Plus Jakarta Sans' },
  { value: 'manrope', label: 'Manrope' },
  { value: 'sora', label: 'Sora' },
  { value: 'space-grotesk', label: 'Space Grotesk' },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans' },
  { value: 'roboto', label: 'Roboto' },
  { value: 'open-sans', label: 'Open Sans' },
  { value: 'lato', label: 'Lato' },
  { value: 'montserrat', label: 'Montserrat' },
  { value: 'poppins', label: 'Poppins' },
  { value: 'nunito', label: 'Nunito' },
  { value: 'work-sans', label: 'Work Sans' },
  { value: 'lora', label: 'Lora (serif)' },
  { value: 'merriweather', label: 'Merriweather (serif)' },
  { value: 'playfair', label: 'Playfair Display (serif)' },
  { value: 'oswald', label: 'Oswald' },
];
export const SANS_OPTIONS = FONT_OPTIONS;
export const DISPLAY_OPTIONS: { value: DisplayKey; label: string }[] = FONT_OPTIONS;
