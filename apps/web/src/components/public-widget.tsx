import Script from 'next/script';

export async function PublicWidget() {
  return (
    <Script
      src="http://localhost:3002/widget.js"
      strategy="afterInteractive"
      data-agent="6a480527ff75bd66fcba4bc6"
      data-widget-url="http://localhost:3001"
      data-api-url="http://localhost:4000/api/v1"
    />
  );
}
