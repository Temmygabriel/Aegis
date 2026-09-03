import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-src",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono-src",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aegis — Agent Non-Performance Insurance",
  description:
    "Underwrite and claim against non-performance risk in the agentic marketplace, on GenLayer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${spaceMono.variable}`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
