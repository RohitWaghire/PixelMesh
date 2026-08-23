/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    'bullmq',
    'ioredis',
    'sharp',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    '@prisma/client'
  ],
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  }
};

export default nextConfig;
