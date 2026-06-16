import type { Metadata } from 'next';
import { LandingPageShell } from '@/components/ns/landing-page-shell';
import { APP_NAME, APP_LEGAL_NAME } from '@/lib/app-config';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `Privacy policy for ${APP_NAME}.`,
};

export default function Page() {
  return (
    <LandingPageShell>
      <section className="main-container px-5 py-20 lg:py-28">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-4xl font-bold tracking-tight text-primary mb-2">Privacy Policy</h1>
          <p className="text-primary-50 mb-10">Last updated: December 29, 2025</p>

          <div className="prose prose-invert max-w-none space-y-8 text-primary-50">

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">1. Introduction</h2>
              <p>Welcome to {APP_NAME}, operated by {APP_LEGAL_NAME} (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). We are committed to protecting your personal information and your right to privacy. This policy explains how we collect, use, disclose, and safeguard your information when you use our platform.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">2. Information We Collect</h2>
              <p className="font-medium text-primary mb-2">Personal Information</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Name and email address when creating an account</li>
                <li>Billing information and payment details for subscriptions (processed by Paddle)</li>
                <li>Profile information you choose to provide</li>
                <li>Communication preferences</li>
              </ul>
              <p className="font-medium text-primary mt-4 mb-2">Usage Information</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Conversation transcripts between visitors, the AI agent, and operators</li>
                <li>Knowledge-base documents you upload or websites you ingest</li>
                <li>Widget configuration, analytics events, and operator activity</li>
                <li>Log data including IP address, browser type, and access times</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">3. How We Use Your Information</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>Provide, maintain, and improve the AI customer-support platform</li>
                <li>Process transactions and send related information</li>
                <li>Send technical notices, updates, and support messages</li>
                <li>Respond to comments, questions, and customer service requests</li>
                <li>Monitor and analyze trends, usage, and activities</li>
                <li>Detect, investigate, and prevent fraudulent transactions</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">4. Payment Processing</h2>
              <p>All payment transactions are processed by Paddle.com, who acts as the Merchant of Record. Paddle maintains appropriate administrative, physical, and technical safeguards for protection of the security, confidentiality and integrity of your payment data. Their Privacy Policy is available at paddle.com/legal/privacy.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">5. Data Sharing and Disclosure</h2>
              <p className="mb-2">We do not sell your personal information. Information may be shared with:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><span className="font-medium text-primary">Payment Processor:</span> Paddle.com for processing transactions</li>
                <li><span className="font-medium text-primary">Service Providers:</span> Third-party vendors who assist in providing our services</li>
                <li><span className="font-medium text-primary">Legal Requirements:</span> When required by law or to protect our rights</li>
                <li><span className="font-medium text-primary">Business Transfers:</span> In connection with a merger, acquisition, or sale of assets</li>
                <li><span className="font-medium text-primary">With Your Consent:</span> When you have given us explicit permission to share</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">6. Data Security</h2>
              <p>{APP_LEGAL_NAME} implements appropriate technical and organizational security measures to protect your personal information. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">7. Your Rights</h2>
              <p className="mb-2">Depending on your location, you may have the following rights:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Access and receive a copy of your personal data</li>
                <li>Rectify or update inaccurate personal data</li>
                <li>Request deletion of your personal data</li>
                <li>Object to or restrict processing of your data</li>
                <li>Data portability</li>
                <li>Withdraw consent at any time</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">8. Cookies and Tracking</h2>
              <p>We use cookies and similar tracking technologies to collect and track information about your activity on our platform. You can control cookies through your browser settings.</p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-primary mb-3">9. Contact Us</h2>
              <p>Questions should be directed to: <a href="mailto:privacy@chataxis.com" className="text-primary underline underline-offset-2">privacy@chataxis.com</a></p>
            </div>

          </div>
        </div>
      </section>
    </LandingPageShell>
  );
}
