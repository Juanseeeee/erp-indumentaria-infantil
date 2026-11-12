import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // El navegador habla solo con el mismo origen: cookies first-party, sin CORS.
  // En local, Next reenvía /api a la API. En Vercel lo hace el ruteo de servicios (vercel.json),
  // así que no se agrega el proxy (además se fijaría en el build, cuando no hay URL interna).
  async rewrites() {
    if (process.env.VERCEL) return [];
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  poweredByHeader: false,
};

export default config;
