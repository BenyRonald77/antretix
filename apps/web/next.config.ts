import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@antretix/shared"],
  poweredByHeader: false,
};

// Output standalone (untuk image Docker) membutuhkan symlink, yang di Windows tanpa Developer Mode tidak diizinkan.
if (process.env.NEXT_STANDALONE === "1") {
  nextConfig.output = "standalone";
  nextConfig.outputFileTracingRoot = path.join(import.meta.dirname, "../../");
}

export default nextConfig;
