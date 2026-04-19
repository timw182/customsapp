import { Fraunces, DM_Sans, JetBrains_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"],
  display: "swap",
});

const dmsans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dmsans",
  display: "swap",
});

const jbm = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jbm",
  display: "swap",
});

export const metadata = {
  title: "Dutify — EU Customs Dossier",
  description:
    "Luxembourg import duty, TARIC classification, excise & CBAM — a dossier for customs brokers and importers.",
  icons: { icon: "/favicon.svg" },
};

export default async function RootLayout({ children }) {
  const session = await auth();
  return (
    <html lang="en" className={`${fraunces.variable} ${dmsans.variable} ${jbm.variable}`}>
      <body>
        <SessionProvider session={session}>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
