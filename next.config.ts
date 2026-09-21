import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
