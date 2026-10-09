import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import RegisterSw from "@/components/RegisterSw";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "HailMap",
  description: "Live US hail, wind, and tornado reports, property storm history, and field notes.",
  applicationName: "HailMap",
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
    title: "HailMap",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#eef3f8",
};

const themeBoot = `(function(){try{if(localStorage.getItem("hailmap-theme")==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#0b111a");}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <RegisterSw />
        {children}
      </body>
    </html>
  );
}
