import Script from 'next/script';

export async function PublicWidget() {
  return (
    <Script
          src="http://localhost:3002/widget.js"
          strategy="afterInteractive"
          data-agent="6a4e5ac052417e607803c27b"
          data-widget-url="http://localhost:3001"
          data-api-url="http://localhost:4000/api/v1"
        />
  );
}
