import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Inter for UI text, JetBrains Mono for telemetry readouts — the pairing
// specified by the "Mission Tactical" design system in Stitch.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "911 Dispatch Digital Twin",
  description:
    "Live SUMO traffic simulation of SoMa, San Francisco with real-time incident detection and dispatch camera flyover.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-on-surface overflow-hidden select-none">
        {children}
      </body>
    </html>
  );
}
