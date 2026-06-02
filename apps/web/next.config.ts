import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@csb/ui", "@csb/shared-types"],
  outputFileTracingRoot: process.env.NEXT_OUTPUT_FILE_TRACING_ROOT,
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
