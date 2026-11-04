import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // El navegador habla solo con Next (mismo origen): cookies first-party, sin CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  poweredByHeader: false,
};

export default config;
