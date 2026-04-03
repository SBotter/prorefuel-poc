import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Required for @ffmpeg/ffmpeg WASM: enables SharedArrayBuffer
  async headers() {
    return [
      {
        source: "/(.*)",
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
