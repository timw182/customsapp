import { Oswald, DM_Sans, Courier_Prime } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import "./globals.css";

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  variable: "--font-oswald",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-sans",
  display: "swap",
});

const courierPrime = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-courier-prime",
  display: "swap",
});

export const metadata = {
  title: "Dutify — Luxembourg Import Duty Calculator",
  description:
    "Calculate EU customs duties and import VAT for shipments into Luxembourg. Real-time ECB exchange rates, AI-powered HS code classification.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Dutify — Luxembourg Import Duty Calculator",
    description: "Calculate EU customs duties and import VAT for shipments into Luxembourg.",
    type: "website",
  },
};

export default async function RootLayout({ children }) {
  const session = await auth();
  return (
    <html lang="en" className={`${oswald.variable} ${dmSans.variable} ${courierPrime.variable}`}>
      <body>
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
