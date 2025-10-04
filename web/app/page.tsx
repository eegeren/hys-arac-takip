import { apiUrl } from "../lib/api";
"use client";

import { useEffect, useState } from "react";

type UpcomingDocument = {
  id: number;
  doc_id: number;
  plate: string;
  doc_type: string;
  valid_from: string | null;
  valid_to: string;
  note?: string | null;
  days_left: number | null;
  status: string;
  responsible_email?: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const DOC_TYPE_LABELS: Record<string, string> = {
  inspection: "Muayene",
  muayene: "Muayene",
  k_document: "K Belgesi",
  "k belgesi": "K Belgesi",
  traffic_insurance: "Trafik Sigortası",
  insurance: "Trafik Sigortası",
  "trafik sigortası": "Trafik Sigortası",
  kasko: "Kasko",
};

const docTypeLabel = (value: string) => {
  const safe = value ?? "";
  const key = safe.toLowerCase().replace(/\s+/g, "_");
  return DOC_TYPE_LABELS[key] ?? safe.replace(/_/g, " ");
};

const statusClass = (status: string) => {
  switch (status) {
    case "critical":
      return "bg-rose-600/80 border-rose-300/60";
    case "warning":
      return "bg-amber-600/80 border-amber-300/60";
    case "ok":
      return "bg-emerald-600/80 border-emerald-300/60";
    case "expired":
      return "bg-rose-900/80 border-rose-400/60";
    default:
      return "bg-slate-800/80 border-slate-600/60";
  }
};

export default function DashboardPage() {
  const [docs, setDocs] = useState<UpcomingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchDocs = async () => {
      try {
        const res = await fetch(`${API_BASE}/documents/upcoming?days=60`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("API hatası");
        const data = (await res.json()) as UpcomingDocument[];
        setDocs(
          data.map((doc) => ({
            ...doc,
            days_left: doc.days_left !== null ? Number(doc.days_left) : null,
          }))
        );
        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.error(err);
        setError("Belgeler çekilirken hata oluştu");
      } finally {
        setLoading(false);
      }
    };

    fetchDocs();
    return () => controller.abort();
  }, []);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Belge Takip Panosu</h2>
          <p className="text-sm text-slate-400">Önümüzdeki 60 gün içinde süresi dolacak belgeler</p>
        </div>
        <span className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-300">
          {loading ? "Yükleniyor..." : `${docs.length} belge`}
        </span>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-900/40 p-4 text-sm text-rose-100">
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
              key={doc.id ?? doc.doc_id}
              className={`rounded-xl border shadow-lg shadow-slate-900/40 transition hover:-translate-y-1 hover:shadow-slate-800/60 ${statusClass(doc.status)}`}
            >
              <div className="space-y-2 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm uppercase tracking-wide text-white/70">Plaka</span>
                  <span className="text-lg font-semibold text-white">{doc.plate}</span>
                </div>
                <div>
                  <span className="text-sm uppercase tracking-wide text-white/70">Belge Türü</span>
                  <h3 className="text-xl font-semibold capitalize text-white">{docTypeLabel(doc.doc_type)}</h3>
                </div>
                {doc.valid_from ? (
                  <div className="flex items-center justify-between text-xs text-white/70">
                    <span>Geçerlilik Başlangıcı</span>
                    <span>{new Date(doc.valid_from).toLocaleDateString("tr-TR")}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between text-sm text-white/80">
                  <span>Bitiş Tarihi</span>
                  <span>{new Date(doc.valid_to).toLocaleDateString("tr-TR")}</span>
                </div>
                <div className="flex items-center justify-between text-sm font-medium text-white">
                  <span>Kalan Gün</span>
                  <span>{doc.days_left ?? "-"}</span>
                </div>
                {doc.note ? (
                  <p className="text-xs text-white/70">Not: {doc.note}</p>
                ) : null}
                <div className="text-xs text-white/70">
                  Sorumlu: {doc.responsible_email ?? "Tanımlı değil"}
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
