import type { Metadata } from 'next';
import { LandingPageShell } from '@/components/ns/landing-page-shell';

export const metadata: Metadata = {
  title: 'Refund Policy',
  description: 'Refund policy for ShipFaster.',
};

export default function Page() {
  return (
    <LandingPageShell>
      <section className="main-container px-5 py-20 lg:py-28">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-4xl font-bold tracking-tight text-primary mb-10">Refund Policy</h1>

          <div className="prose prose-invert max-w-none space-y-8 text-primary-50">

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">Cancellation Window</h2>
              <p>Customers are granted a 14-day cancellation window from the transaction completion date, without needing to provide any reason.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">Refund Request Process</h2>
              <p className="mb-2">To request a refund, customers must contact:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Email: <a href="mailto:support@shipfaster.app" className="text-primary underline underline-offset-2">support@shipfaster.app</a></li>
                <li>Or contact Paddle directly</li>
              </ul>
              <p className="mt-2">Customers must include their order number and purchase email address in the request. Reimbursements are processed within 14 days using the original payment method, at no additional cost.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">Exception for Digital Content</h2>
              <p>The cancellation right does not apply to digital content once a download has begun. By acquiring digital products, customers acknowledge that:</p>
              <blockquote className="border-l-4 border-primary/40 pl-4 mt-3 italic text-primary-50/80">
                &ldquo;You will lose your right of withdrawal once the download or applicable transmission of the digital content has begun.&rdquo;
              </blockquote>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">Subscription Details</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>Recurring subscriptions renew automatically until cancelled.</li>
                <li>Cancellation requests require at least 48 hours advance notice before the end of a billing cycle.</li>
                <li>The 14-day refund window applies only to the initial purchase — subsequent renewal periods are not eligible for refunds.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">Processing Timeline</h2>
              <p>Refunds are handled by Paddle and typically complete within 5–10 business days. Additional delays may occur depending on the customer&apos;s banking institution.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">Contact Us</h2>
              <p>Email: <a href="mailto:support@shipfaster.app" className="text-primary underline underline-offset-2">support@shipfaster.app</a></p>
              <p className="mt-1">Response time: Within 24–48 business hours</p>
            </div>

          </div>
        </div>
      </section>
    </LandingPageShell>
  );
}
