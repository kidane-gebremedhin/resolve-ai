import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@csb/ui", "@csb/shared-types"],
  outputFileTracingRoot: process.env.NEXT_OUTPUT_FILE_TRACING_ROOT,
  // Ensure NextAuth uses the admin-specific URL (ADMIN_NEXTAUTH_URL) instead of
  // the shared NEXTAUTH_URL which points at the web app on :3000.
  env: {
    NEXTAUTH_URL: process.env.ADMIN_NEXTAUTH_URL ?? "http://localhost:3003",
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
