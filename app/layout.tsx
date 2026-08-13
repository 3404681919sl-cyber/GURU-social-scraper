import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "社媒数据采集工作台",
  description: "面向团队的社媒数据采集、质检、看板与自动化工作台。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
