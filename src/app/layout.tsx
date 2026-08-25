import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Crisp — Self-correcting document Q&A",
  description: "Upload PDFs, ask questions, get cited answers that improve every time you correct them.",
};

const themeInit = `(function(){try{var t=localStorage.getItem('crisp-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} min-h-[100dvh]`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
