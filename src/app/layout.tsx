import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import RegisterSw from "@/components/RegisterSw";
import { themeBootScript } from "@/lib/palette";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const description = "Live US hail, wind, and tornado reports, property storm history, field notes, and phone hail alerts.";

export const metadata: Metadata = {
  title: "Swathline",
  description,
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
    title: "Swathline",
    description,
    siteName: "Swathline",
  },
  twitter: {
    title: "Swathline",
    description,
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
    <html lang="en" data-palette="a" className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
        <RegisterSw />
        {children}
      </body>
    </html>
  );
}
