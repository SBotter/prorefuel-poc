import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL = "https://lens.prorefuel.app";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),

  title: {
    default: "LENS — Cinematic GPS Video Editor for Cyclists, MTB & Trail Runners",
    template: "%s | LENS by ProRefuel",
  },

  description:
    "Automatically create cinematic GPS telemetry videos from your GoPro or iPhone footage and GPX activity file. Speed, elevation, heart rate overlay — synced in seconds. Free, on-device, no upload. Perfect for cyclists, MTB riders, trail runners and triathletes.",

  keywords: [
    "cinematic GPS overlay video editor",
    "GoPro telemetry video maker",
    "automatic cycling video editor",
    "GPS video overlay app",
    "MTB GoPro video editor",
    "trail run GPS video",
    "action camera cinematic edit",
    "GPX video sync",
    "sports video telemetry overlay",
    "cycling highlight video maker",
    "GoPro Quik alternative with GPS",
    "DashWare alternative free",
    "create cycling video from GPX file",
    "iPhone GPS video overlay",
    "Garmin Strava video creator",
    "Suunto GPX video editor",
    "outdoor sports video generator",
    "triathlon video with performance metrics",
    "hiker GoPro video elevation data",
    "automatic sports video no editing skills",
  ],

  authors: [{ name: "ProRefuel", url: "https://prorefuel.app" }],
  creator: "ProRefuel",
  publisher: "ProRefuel",

  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },

  alternates: {
    canonical: APP_URL,
  },

  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "LENS by ProRefuel",
    title: "LENS — Cinematic GPS Video Editor for Cyclists, MTB & Trail Runners",
    description:
      "Turn your GoPro or iPhone footage + GPX file into a cinematic 9:16 video with live GPS overlay. Speed, elevation, heart rate — synced automatically. Free, private, no cloud.",
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "LENS by ProRefuel — Cinematic GPS Video Editor for outdoor sports athletes",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "LENS — Cinematic GPS Video Editor for Athletes",
    description:
      "GoPro + GPX = cinematic video in under 60 seconds. Speed, elevation, map overlay — automatic. Free & private.",
    images: ["/og-image.png"],
  },

  icons: {
    icon: "/LENS.ico",
    shortcut: "/LENS.ico",
    apple: "/LENS.ico",
  },

  category: "sports, multimedia, video editing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
