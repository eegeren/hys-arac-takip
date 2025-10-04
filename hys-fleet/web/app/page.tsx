"use client";

import { useEffect, useState } from "react";

type Document = {
  id: number;
  plate: string;
  doc_type: string;
  valid_to: string;
  days_left: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function DashboardPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchDocs = async () => {
      try {
        const res = await fetch(`${API_BASE}/documents/upcoming`, {
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("API hatası");
        const data = (await res.json()) as Document[];
        setDocs(
          data.map((doc) => ({
            ...doc,
            days_left: Number(doc.days_left),
          }))
        );
        setError(null);
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        console.error(error);
        setError("Belgeler çekilirken hata oluştu");
      } finally {
        setLoading(false);
      }
    };

    fetchDocs();

    return () => {
      controller.abort();
    };
  }, []);

  const colorForDays = (days: number) => {
    if (!Number.isFinite(days)) return "bg-slate-800/80 border-slate-600/60";
    if (days <= 7) return "bg-rose-600/80 border-rose-300/60";
    if (days <= 15) return "bg-amber-600/80 border-amber-300/60";
    if (days <= 30) return "bg-emerald-600/80 border-emerald-300/60";
    return "bg-slate-800/80 border-slate-600/60";
  };

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Belge Takip Panosu</h2>
        <span className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-300">
          {loading ? "Yükleniyor..." : `${docs.length} belge`}
        </span>
      </div>
      {error ? (
        <p className="mb-6 rounded-lg border border-rose-500/30 bg-rose-900/40 p-4 text-sm text-rose-100">
          {error}
        </p>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {docs.length === 0 && !loading ? (
          <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">
            Önümüzdeki 60 gün içinde süresi dolacak belge bulunmuyor.
          </p>
        ) : (
          docs.map((doc) => (
            <article
              key={doc.id}
              className={`rounded-xl border shadow-lg shadow-slate-900/40 transition hover:-translate-y-1 hover:shadow-slate-800/60 ${colorForDays(doc.days_left)}`}
            >
              <div className="space-y-2 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm uppercase tracking-wide text-white/70">Plaka</span>
                  <span className="text-lg font-semibold text-white">{doc.plate}</span>
                </div>
                <div>
                  <span className="text-sm uppercase tracking-wide text-white/70">Belge Türü</span>
                  <h3 className="text-xl font-semibold capitalize text-white">{doc.doc_type.replace(/_/g, " ")}</h3>
                </div>
                <div className="flex items-center justify-between text-sm text-white/80">
                  <span>Bitiş Tarihi</span>
                  <span>{doc.valid_to}</span>
                </div>
                <div className="flex items-center justify-between text-sm font-medium text-white">
                  <span>Kalan Gün</span>
                  <span>{doc.days_left}</span>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
