import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@csb/ui", "@csb/shared-types"],
};

export default nextConfig;
