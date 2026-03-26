import type { Metadata } from "next";
import { Manrope, Newsreader } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReBabel | 焕译",
  description:
    "AI 驱动的双语阅读平台。上传英文原著，生成更自然的中文翻译，并进行优雅的中英对照阅读。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${manrope.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
