import type { NextConfig } from "next";

/**
 * Security headers (SPEC §13). CSP allows self plus the two external hosts
 * the app legitimately talks to from the browser: Cloudflare Turnstile
 * (script + iframe + verification) and R2 presigned URLs (artwork images and
 * direct uploads). pdf.js runs as a blob worker. 'unsafe-inline' script-src
 * is required by Next.js hydration without a nonce pipeline; all user input
 * is React-escaped and never rendered as HTML.
 */
// next dev serves eval sourcemaps; production stays strict.
const scriptExtra =
  process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${scriptExtra} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
  "connect-src 'self' https://challenges.cloudflare.com https://*.r2.cloudflarestorage.com",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Secret-URL and admin pages must never be indexed.
      {
        source: "/p/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
