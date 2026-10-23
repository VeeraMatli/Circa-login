import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Zyra · Operations",
  description: "A considered space for safer connections.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
