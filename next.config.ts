
import type {NextConfig} from 'next';

// Set when building for GitHub Pages, which serves the site from /<repo-name>.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

// How many workers one build may run at once. Saligue is compiled on the same small machine that serves it,
// and a build that uses every core asks for more RAM than that machine has — the kernel then kills it
// mid-compile ("Killed", exit 137). Set SALIGUE_BUILD_CPUS=1 on a tight box; leave it unset and the build
// uses every core, exactly as before. A box that builds its own site should also have swap (4 GB on the
// 8 GB Hetzner machine), so a build that runs out of memory is slowed down instead of being killed — and
// so the kernel never has to choose between the build and the site it is serving.
const buildCpus = Math.max(1, Math.min(16, Math.round(Number(process.env.SALIGUE_BUILD_CPUS) || 0)));

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
  experimental: {
    ...(buildCpus ? { cpus: buildCpus } : {}),
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
