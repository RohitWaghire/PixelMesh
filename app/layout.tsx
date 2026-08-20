import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PixelMesh — WebMCP Image Studio & Cryptographic Gateway",
  description: "AI Agent-First Image Tool Mesh with SSH-style Asymmetric Cryptographic Authentication",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-cyber-dark text-zinc-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
