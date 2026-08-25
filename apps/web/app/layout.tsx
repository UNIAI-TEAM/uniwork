import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "UniWork" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
