import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Riot Sonar Revoker",
  description: "Revokes Google Drive and Microsoft 365 sharing permissions when Riot Sonar asks for it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
