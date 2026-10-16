import {AnalyticsProvider} from "@/components/analytics-provider";
import {enabled} from "@/server/analytics/journal";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { PwaProvider } from "@/components/pwa-provider";
export const metadata: Metadata = {
  title: "Family Events",
  applicationName: "Family Events",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Family Events",
    statusBarStyle: "default",
  },
  icons: {
    apple: [
      { url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
    icon: "/icons/icon-192.png",
  },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7e50c5",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body>
        <AnalyticsProvider enabled={enabled()}><PwaProvider>{children}</PwaProvider></AnalyticsProvider>
      </body>
    </html>
  );
}
