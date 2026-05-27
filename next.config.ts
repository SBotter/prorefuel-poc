import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for @ffmpeg/ffmpeg WASM: enables SharedArrayBuffer.
  // Scoped to engine routes only — landing page must NOT have COEP, which
  // would force the browser to validate every cross-origin subresource and
  // block those that lack CORP headers (fonts, analytics, etc.).
  async headers() {
    return [
      // Engine routes — full isolation (require-corp) for SharedArrayBuffer.
      {
        source: "/(render-hero|v2)(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy",   value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      // Upload pages — credentialless COEP enables SharedArrayBuffer without
      // blocking cross-origin resources (fonts, analytics) that lack CORP headers.
      // This unlocks multi-threaded FFmpeg.wasm for HEVC transcoding.
      // credentialless supported: Chrome 96+, Edge 96+, Firefox 119+.
      // Safari supports HEVC natively so never reaches FFmpeg.wasm.
      {
        source: "/mobile(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy",   value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },

  // Empty turbopack config to silence the webpack/turbopack mismatch warning
  turbopack: {},
};

export default nextConfig;
