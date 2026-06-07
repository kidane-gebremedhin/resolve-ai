"use client";

// Phone input with a country-code dropdown (flags + dial codes), built on
// react-phone-number-input / libphonenumber-js. The country defaults to the
// visitor's geo-detected country (from /widget/init) but is fully overridable.
// Value is emitted in E.164 (e.g. "+14155550123"). Phone stays optional.

import PhoneInput, { type Country } from "react-phone-number-input";
import "react-phone-number-input/style.css";

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
      placeholder={placeholder}
      disabled={disabled}
      className="csb-phone-field flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus-within:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
    />
  );
}
