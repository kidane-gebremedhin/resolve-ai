import Script from 'next/script';

export async function PublicWidget() {
  return (
    <Script
      src="https://widget.addisai.pro/widget.js"
      strategy="afterInteractive"
      data-agent="6a306233c1585e817bf991c4"
      data-widget-url="https://e145pl3s7xcydow2n503ncvw.157.173.125.72.sslip.io"
      data-api-url="https://back.addisai.pro/api/v1"
    />
  );
}
