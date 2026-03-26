import type { NextConfig } from "next";

const isGithubPages = process.env.GITHUB_PAGES === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: isGithubPages ? "export" : undefined,
  trailingSlash: isGithubPages,
  images: {
    unoptimized: true,
  },
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
