
import type {NextConfig} from 'next';

// Set when building for GitHub Pages, which serves the site from /<repo-name>.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  // Static site: all AI runs in the browser and data comes from Firebase, so no server is needed.
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
  allowedDevOrigins: [
    'https://6000-firebase-studio-1757425340606.cluster-lu4mup47g5gm4rtyvhzpwbfadi.cloudworkstations.dev',
  ],
};

export default nextConfig;
