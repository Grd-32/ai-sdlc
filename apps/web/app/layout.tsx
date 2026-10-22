import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getSiteOrigin } from "@/lib/public-site";
import { ProductAnalytics } from "@/components/product-analytics";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Nomalog — security governance for AI-assisted software",
    template: "%s | Nomalog",
  },
  description:
    "Assess security and governance signals in AI-assisted code changes. Connect GitHub pull requests to risk, policy decisions, human review, and evidence.",
  metadataBase: new URL(getSiteOrigin()),
  openGraph: {
    type: "website",
    siteName: "Nomalog",
    title: "Nomalog — security governance for AI-assisted software",
    description:
      "Connect code changes, security findings, risk decisions, policy, approvals, and evidence through a Change Passport.",
  },
  twitter: {
    card: "summary",
    title: "Nomalog — security governance for AI-assisted software",
    description:
      "Assess security and governance signals in AI-assisted code changes with evidence linked to each change.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('nomalog-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch{}",
          }}
        />
      </head>
      <body className={inter.className}>
        {children}
        <ProductAnalytics />
      </body>
    </html>
  );
}
