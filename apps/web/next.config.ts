import type { NextConfig } from 'next';
const config: NextConfig = {
  devIndicators: false,
  agentRules: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.aave.com', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'app.aave.com', port: '', pathname: '/icons/tokens/*.svg' },
      { protocol: 'https', hostname: 'token-logos.family.co', port: '', pathname: '/asset' },
    ],
    minimumCacheTTL: 7 * 24 * 60 * 60,
    maximumRedirects: 0,
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'none'; script-src 'none'; sandbox;",
  },
  async headers() {
    return [{ source: '/tokens/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] }];
  },
};
export default config;
