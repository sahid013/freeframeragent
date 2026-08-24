import type {NextConfig} from 'next';

/**
 * Optional hardening: set FRAME_ANCESTORS to a space-separated list of origins
 * allowed to iframe /embed, e.g.
 *   FRAME_ANCESTORS="https://*.framer.app https://*.framer.website https://mysite.com"
 * Left unset, any site can embed the widget.
 */
const frameAncestors = process.env.FRAME_ANCESTORS?.trim();

const nextConfig: NextConfig = {
  async headers() {
    if (!frameAncestors) return [];
    return [
      {
        source: '/embed',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors 'self' ${frameAncestors};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
