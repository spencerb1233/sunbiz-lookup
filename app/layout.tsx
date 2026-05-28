import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sunbiz Lookup — Florida LLC owner records",
  description:
    "Cross-reference Florida LLC and corporate filings against your property data. Public data from the Florida Division of Corporations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
