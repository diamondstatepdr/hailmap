import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import type { ReactNode } from "react";
import RegisterSw from "@/components/RegisterSw";
import { themeBootScript } from "@/lib/palette";
import { introBootScript } from "@/lib/plain";
import { SHARE_IMAGE, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site-meta";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "800",
  display: "swap",
  variable: "--font-mark",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "Swathline",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Swathline",
    statusBarStyle: "default",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "Swathline",
    type: "website",
    url: SITE_URL,
    images: [
      {
        url: SHARE_IMAGE,
        width: 1200,
        height: 630,
        alt: "Swathline hail swath across the central United States",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e7eefb",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-palette="a" className={`${inter.variable} ${montserrat.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: introBootScript() }} />
        <RegisterSw />
        {children}
      </body>
    </html>
  );
}
