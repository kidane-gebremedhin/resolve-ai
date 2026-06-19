import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@csb/ui", "@csb/shared-types"],
  outputFileTracingRoot: process.env.NEXT_OUTPUT_FILE_TRACING_ROOT,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        // Allow the widget proxy (back.chataxis.pro) to load any Next.js static
        // asset (fonts, chunks, CSS) from chataxis.pro without CORS errors.
        // Covers /_next/static/media/ (fonts), /_next/static/css/, /_next/static/chunks/.
        source: "/_next/static/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
