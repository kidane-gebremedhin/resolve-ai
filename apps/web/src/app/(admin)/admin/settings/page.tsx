// Platform-admin settings page. Server component fetches the singleton
// PlatformSetting doc from /admin/settings, then hands it to the real,
// fully-wired AdminSettingsForm client component for editing + persistence.
//
// The previous local-state-only <SettingsForm /> stub remains in
// components/admin/settings-form.tsx for reference but is no longer rendered.

import { api, ApiError } from "@/lib/api";
import {
  AdminSettingsForm,
  type PlatformSettings,
} from "@/components/admin/settings-real";

export const dynamic = "force-dynamic";

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    // 404/permission failures fall through to the empty-defaults editor.
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function AdminSettingsPage() {
  const settings = await safeGet<PlatformSettings>("/admin/settings");

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">System settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Platform-wide configuration. Changes save to the singleton PlatformSetting doc.
      </p>

      <AdminSettingsForm initial={settings} />
    </div>
  );
}
