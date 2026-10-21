import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  async redirects() {
    return [
      {
        source: '/admin',
        destination: 'https://onlinebar.onrender.com/lord/ticketing',
        permanent: false
      },
      {
        source: '/admin/:path*',
        destination: 'https://onlinebar.onrender.com/lord/ticketing',
        permanent: false
      }
    ];
  }
};

export default nextConfig;
