import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KDP Mail Approval",
  description:
    "Kansas Democratic Party mail piece submission and approval system",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
