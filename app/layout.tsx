import type { Metadata } from "next";
import "./tokens.css";

export const metadata: Metadata = {
  title: "交換帳本 · Trade Ledger",
  description: "在私人圈中管理供需、安排交換並共同確認帳本。預設採獨立創作示範目錄。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* Apply the saved/system theme before paint to avoid a bright flash. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme.js" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
