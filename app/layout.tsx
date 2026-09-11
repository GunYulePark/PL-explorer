import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "손익 Explorer",
  description: "품목·기간·조직 기준 손익 조회 MVP",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
