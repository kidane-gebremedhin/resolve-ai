import Script from 'next/script';

export async function PublicWidget() {
  return (
    <Script
          src="http://localhost:3002/widget.js"
          strategy="afterInteractive"
          data-agent="6a56ac0ea326e59f6f93cf19"
          data-widget-url="http://localhost:3001"
          data-api-url="http://localhost:4000/api/v1"
        />
  );
}
