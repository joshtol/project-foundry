import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { auth, signOut } from "@/auth";
import { UserMenu } from "@/components/UserMenu";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Project Foundry",
  description: "Hardware design lifecycle tracker",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the session server-side so the UserMenu only renders for
  // signed-in users. `/sign-in` and `/api/auth/*` are excluded from the
  // middleware matcher (src/middleware.ts), so on those routes auth()
  // returns null and the menu stays hidden.
  const session = await auth();
  const email = session?.user?.email ?? null;

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {email ? (
          <header className="sticky top-0 z-20 flex items-center justify-end border-b border-panel-border bg-deep-space px-6 py-2">
            <UserMenu email={email} signOutAction={signOutAction} />
          </header>
        ) : null}
        {children}
      </body>
    </html>
  );
}
