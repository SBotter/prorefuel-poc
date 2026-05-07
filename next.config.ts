import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for @ffmpeg/ffmpeg WASM: enables SharedArrayBuffer.
  // Scoped to engine routes only — landing page must NOT have COEP, which
  // would force the browser to validate every cross-origin subresource and
  // block those that lack CORP headers (fonts, analytics, etc.).
  async headers() {
    return [
      {
        source: "/(render-hero|v2)(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },

  // Empty turbopack config to silence the webpack/turbopack mismatch warning
  turbopack: {},
};

export default nextConfig;
