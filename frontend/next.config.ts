import type { NextConfig } from "next";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "..");
const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  turbopack: { root: repositoryRoot },
  devIndicators: false,
  // The Node worker runs outside Next's route dependency tracing.
  outputFileTracingIncludes: {
    "/*": ["../node_modules/yazl/**/*", "../node_modules/buffer-crc32/**/*", "../node_modules/@aws-sdk/lib-storage/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" }
    ] }];
  }
};
export default config;
