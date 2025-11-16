import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Agentic Source Hub",
  description:
    "Upload and organize multimedia source material ready for AI assistant workflows."
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-surface text-foreground`}>
        {children}
      </body>
    </html>
  );
}
