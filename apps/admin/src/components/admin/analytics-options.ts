// Plain (server-importable) option lists for the Analytics filters. Kept out of
// the 'use client' filter component because importing data constants from a
// client module into a server component yields client-reference proxies (not the
// real arrays), which breaks `.map`/`.find` at build time.

export const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 180 days' },
] as const;

export const METRIC_OPTIONS = [
  { value: 'all', label: 'All metrics' },
  { value: 'signups', label: 'Signups' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'messages', label: 'Messages' },
] as const;
