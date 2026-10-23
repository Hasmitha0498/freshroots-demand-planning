import type { NextConfig } from "next";

// cacheComponents/partialPrefetching are intentionally off: every page in this
// app shows per-request, authenticated planning data, so classic dynamic
// rendering is the simplest correct model.
const nextConfig: NextConfig = {
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
