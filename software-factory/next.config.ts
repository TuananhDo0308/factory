import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` refuses its dev assets to hosts other than localhost; list LAN hosts that share it.
  allowedDevOrigins: (process.env.SF_ALLOWED_DEV_ORIGINS || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  outputFileTracingIncludes: {
    "/api/cli/sf.ts": ["./cli/sf.ts"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
