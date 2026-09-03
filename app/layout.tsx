import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PixelMesh — WebMCP Image Studio & Cryptographic Gateway",
  description: "AI Agent-First Image Tool Mesh with SSH-style Asymmetric Cryptographic Authentication",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="bg-cyber-dark text-zinc-100 min-h-screen antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
