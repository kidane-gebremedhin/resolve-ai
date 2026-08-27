"use client";

// Phone input with a country-code dropdown (flags + dial codes), built on
// react-phone-number-input / libphonenumber-js. The country defaults to the
// visitor's geo-detected country (from /widget/init) but is fully overridable.
// Value is emitted in E.164 (e.g. "+14155550123"). Phone stays optional.
//
// Flags are served from OUR origin. react-phone-number-input otherwise points
// flagUrl at https://purecatamphetamine.github.io/..., and this widget renders
// inside our customers' websites — so the default would leak every visitor's IP
// and referrer to a third-party host, tie the widget to that host's uptime, and
// render broken flags for any customer running a strict img-src CSP.
// scripts/copy-flags.mjs vendors the SVGs into public/flags at build time.

import PhoneInput, { type Country } from "react-phone-number-input";
import "react-phone-number-input/style.css";

// Respects a non-root deployment (next.config basePath) so the flags resolve
// wherever the widget is hosted.
const WIDGET_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function PhoneField({
  value,
  onChange,
  defaultCountry,
  disabled,
  placeholder = "Phone (optional)",
}: {
  value: string;
  onChange: (value: string) => void;
  /** ISO country (e.g. "US") used as the initial selection. */
  defaultCountry?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <PhoneInput
      value={value || undefined}
      onChange={(v) => onChange(v ?? "")}
      defaultCountry={(defaultCountry as Country) || undefined}
      international
      countryCallingCodeEditable={false}
      flagUrl={`${WIDGET_BASE_PATH}/flags/{XX}.svg`}
      placeholder={placeholder}
      disabled={disabled}
      className="csb-phone-field flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus-within:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
    />
  );
}
