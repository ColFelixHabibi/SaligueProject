
import type {NextConfig} from 'next';

// Set when building for GitHub Pages, which serves the site from /<repo-name>.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  // Static export: served by Saligue's own server (server/), or hosted elsewhere such as GitHub Pages.
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
    // Static export has no image optimization server; product photos come from the Saligue server.
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
