import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import RegisterSw from "@/components/RegisterSw";
import "./globals.css";

export const metadata: Metadata = {
  title: "HailMap",
  description: "Nationwide live US hail reports, swaths, and county income context.",
  applicationName: "HailMap",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
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
  themeColor: "#f3f6fb",
};

const themeBoot = `(function(){try{if(localStorage.getItem("hailmap-theme")==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#0e141c");}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <RegisterSw />
        {children}
      </body>
    </html>
  );
}
