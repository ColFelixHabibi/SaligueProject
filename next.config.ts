
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    // Photo uploads (try-on sends two) go to server actions; the default limit is 1 MB.
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  allowedDevOrigins: [
    'https://6000-firebase-studio-1757425340606.cluster-lu4mup47g5gm4rtyvhzpwbfadi.cloudworkstations.dev',
  ],
};

export default nextConfig;
