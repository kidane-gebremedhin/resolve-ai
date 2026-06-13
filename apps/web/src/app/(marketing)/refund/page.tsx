import type { Metadata } from 'next';
import { LandingPageShell } from '@/components/ns/landing-page-shell';
import { APP_NAME, APP_LEGAL_NAME } from '@/lib/app-config';

export const metadata: Metadata = {
  title: 'Refund Policy',
  description: `Refund policy for ${APP_NAME}.`,
};

export default function Page() {
  return (
    <LandingPageShell>
      <section className="main-container px-5 py-20 lg:py-28">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-4xl font-bold tracking-tight text-primary mb-10">Refund Policy</h1>

          <div className="prose prose-invert max-w-none space-y-8 text-primary-50">

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">1. Overview</h2>
              <p>{APP_LEGAL_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) operates {APP_NAME}, a software-as-a-service platform. Our payments are processed by Paddle.com, who acts as the Merchant of Record for all transactions. This refund policy is aligned with Paddle&apos;s consumer terms and conditions.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">2. Consumer Right to Cancel</h2>
              <p>If you are a consumer, you have the right to cancel your purchase and receive a full refund within 14 days without giving any reason. The cancellation period will expire after 14 days from the day after completion of the transaction.</p>
              <p className="mt-2">To meet the cancellation deadline, it is sufficient that you send your communication concerning your exercise of the cancellation right before the expiration of the 14-day period.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">3. How to Request a Refund</h2>
              <p className="mb-2">To cancel your order and request a refund, you must inform us of your decision. You can do this by:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Emailing us at support@{APP_NAME.toLowerCase()}.app</li>
                <li>Contacting Paddle directly through their support channels</li>
              </ul>
              <p className="mt-2">Please include your order number and the email address used to make the purchase.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">4. Effect of Cancellation</h2>
              <p>If you cancel your purchase as permitted above, we will reimburse all payments received from you. The reimbursement will be made without undue delay, and not later than 14 days after the day on which we are informed about your decision to cancel. We will make the reimbursement using the same means of payment as you used for the initial transaction and you will not incur any fees as a result of the reimbursement.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">5. Exception to the Right to Cancel</h2>
              <p>Your right as a consumer to cancel your order does not apply to the supply of digital content that you have started to download, stream or otherwise acquire, and to products which you have had the benefit of.</p>
              <p className="mt-2">By downloading or otherwise acquiring the digital content, you consent to immediate performance of the agreement and acknowledge that you will lose your right of withdrawal once the download or applicable transmission of the digital content has begun.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">6. Subscriptions</h2>
              <p>Paid subscriptions automatically renew until cancelled. If you wish to cancel your subscription, please contact us at least 48 hours before the end of the current billing period. Your cancellation will take effect at the next payment date.</p>
              <p className="mt-2">Please note that your right to cancel is only present following the initial subscription and not upon each automatic renewal. There are no refunds on unused subscription periods after the initial 14-day cancellation period.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">7. Refund Processing</h2>
              <p>Refunds are processed by Paddle, our payment processor. Once approved, refunds are typically processed within 5–10 business days. The refund will be issued to the original payment method. Bank processing times may add additional business days.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">8. Contact Us</h2>
              <p>Email: <a href={`mailto:support@${APP_NAME.toLowerCase()}.app`} className="text-primary underline underline-offset-2">support@{APP_NAME.toLowerCase()}.app</a></p>
              <p className="mt-1">Response time: Within 24–48 business hours</p>
            </div>

          </div>
        </div>
      </section>
    </LandingPageShell>
  );
}
