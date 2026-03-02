import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import "./globals.css";

export const metadata = {
  title: "Dutify — Luxembourg Import Duty Calculator",
};

export default async function RootLayout({ children }) {
  const session = await auth();
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;600;700&family=DM+Sans:wght@300;400;500&family=Courier+Prime:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
