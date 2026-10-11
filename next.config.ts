import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  // Public invitation metadata must be present in initial HTML for all link previews.
  htmlLimitedBots: /.*/,
  outputFileTracingIncludes: { "/*": ["./certs/*.crt"] },
  async redirects() {
    return [
      {
        source: "/03-create-event.html",
        destination: "/events/new",
        permanent: false,
      },
      {
        source: "/04-event-management.html",
        destination: "/events",
        permanent: false,
      },
      {
        source: "/01-telegram-login.html",
        destination: "/login",
        permanent: false,
      },
      {
        source: "/02-my-events.html",
        destination: "/events",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://web.telegram.org",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};
export default config;
