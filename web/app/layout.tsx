import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "HYS Fleet",
  description: "Belge takibi ve araç yönetimi paneli",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
          <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold">HYS Araçlar</h1>
              <p className="text-slate-300">
                60 gün içerisinde süresi dolacak belgeler ve araç yönetimi paneli
              </p>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
