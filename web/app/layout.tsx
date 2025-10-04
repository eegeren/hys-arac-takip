import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "HYS Fleet",
  description: "Belge takibi ve araç yönetimi paneli",
};

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/vehicles", label: "Araçlar" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
          <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold">HYS Araç Takip</h1>
              <p className="text-slate-300">
                60 gün içerisinde süresi dolacak belgeler ve araç yönetimi paneli
              </p>
            </div>
            <nav className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 p-1 text-sm">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full px-4 py-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
