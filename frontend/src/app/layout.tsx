import type { Metadata } from "next";
import { Geist, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentPrism — Agent 对比实验台",
  description: "同一问题，多条管线受控并行，差异可量化、可复现",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className={`${geistSans.variable} ${robotoMono.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
