import { CouponsManager } from '@/components/coupons-manager';

export const dynamic = 'force-dynamic';

export default function CouponsPage() {
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Lifetime deal coupons</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Codes for AppSumo / PitchGround / StackSocial fulfilment. Redeeming one upgrades the
        redeemer&apos;s workspace directly — coupons are not checkout discounts and never touch
        Paddle. Generate a batch, hand the CSV to the platform, and track redemptions here.
      </p>
      <CouponsManager />
    </div>
  );
}
