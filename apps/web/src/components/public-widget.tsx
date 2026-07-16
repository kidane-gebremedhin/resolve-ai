import Script from 'next/script';

export async function PublicWidget() {
  return (
    <Script
          src="http://localhost:3002/widget.js"
          strategy="afterInteractive"
          data-agent="6a5a280c00e61481c3974a9c"
          data-widget-url="http://localhost:3001"
          data-api-url="http://localhost:4000/api/v1"
        />
  );
}
