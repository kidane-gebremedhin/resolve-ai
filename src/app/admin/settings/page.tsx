import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

function Page() {
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">System settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Platform-wide configuration.</p>

      <Tabs defaultValue="general" className="mt-6">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6 max-w-2xl space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div><Label>Platform name</Label><Input className="mt-1.5" defaultValue="Helio" /></div>
            <div><Label>Support email</Label><Input className="mt-1.5" defaultValue="support@helio.app" /></div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div><div className="text-sm font-medium">Maintenance mode</div><div className="text-xs text-muted-foreground">Show a banner and pause signups.</div></div>
              <Switch />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="email" className="mt-6 max-w-2xl">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div><Label>SMTP host</Label><Input className="mt-1.5" defaultValue="smtp.postmarkapp.com" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Port</Label><Input className="mt-1.5" defaultValue="587" /></div>
              <div><Label>From address</Label><Input className="mt-1.5" defaultValue="noreply@helio.app" /></div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="api" className="mt-6 max-w-2xl">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div><Label>Default rate limit (req / min)</Label><Input className="mt-1.5" defaultValue="600" /></div>
            <div><Label>API version</Label><Input className="mt-1.5" defaultValue="2025-05" /></div>
          </div>
        </TabsContent>

        <TabsContent value="security" className="mt-6 max-w-2xl space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            {[
              ["Enforce 2FA for admins", true],
              ["Block sign-ins from disposable emails", true],
              ["Require strong passwords", true],
              ["Session timeout after 24h", false],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between text-sm">
                <span>{k}</span>
                <Switch defaultChecked={v as boolean} />
              </div>
            ))}
          </div>
          <Button size="sm">Save changes</Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}


export default Page;
