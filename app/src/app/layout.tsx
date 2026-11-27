import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// UI text: Inter. Its optical-size axis keeps 12–13px sidebar text crisp, and the Vietnamese
// subset means accented letters never fall back to a system font.
const uiFont = Inter({
  variable: "--font-ui",
  subsets: ["latin", "vietnamese"],
  axes: ["opsz"],
});

// Mono for numbers and code. Not Geist Mono: its zero is slashed; JetBrains Mono's is dotted.
const monoFont = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin", "vietnamese"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Factory | Agent-Native Software Control Plane",
  description:
    "Control plane for factory v2 on Claude Code: BA sessions, epic runs, live agents, tokens and cost.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${uiFont.variable} ${monoFont.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
