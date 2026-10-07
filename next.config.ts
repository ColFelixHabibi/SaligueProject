
import type {NextConfig} from 'next';

// Set when building for GitHub Pages, which serves the site from /<repo-name>.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  // Static export keeps the app deployable to GitHub Pages; Supabase supplies hosted auth and data.
  output: 'export',
  basePath,
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    // Static export has no image optimization server; product photos are data URLs anyway.
    unoptimized: true,
  },
  webpack: (config) => {
    // Node-only dependencies of Transformers.js; the browser build uses onnxruntime-web.
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      'onnxruntime-node$': false,
    };
    return config;
  },
};

export default nextConfig;
