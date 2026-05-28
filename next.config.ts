import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: process.env.VERCEL_URL
        ? [process.env.VERCEL_URL, "localhost:3000"]
        : ["localhost:3000"],
    },
  },
};

export default nextConfig;
