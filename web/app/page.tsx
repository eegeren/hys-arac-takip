"use client";
import { apiUrl } from "../lib/api";

import { useEffect, useState } from "react";
import React from "react";

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

type Vehicle = {
  id: number;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  created_at: string;
  document_count: number;
  documents?: Array<{
    id: number;
    doc_type: string;
    valid_from: string | null;
    valid_to: string | null;
    note?: string | null;
    days_left: number | null;
    status: string;
  }>;
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

const formatDaysLabel = (days?: number | null) => {
  if (days === null || days === undefined) return "-";
  if (days < 0) return `${Math.abs(days)} gün geçti`;
  if (days === 0) return "Bugün";
  return `${days} gün kaldı`;
};

export default function DashboardPage() {
  const [docs, setDocs] = useState<UpcomingDocument[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<(Vehicle & { documents: UpcomingDocument[] }) | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchDocsAndVehicles = async () => {
      try {
        const resDocs = await fetch(apiUrl("/api/documents/upcoming?days=60"), {
          signal: controller.signal,
        });
        if (!resDocs.ok) throw new Error("API hatası");
        const dataDocs = (await resDocs.json()) as UpcomingDocument[];
        setDocs(
          dataDocs.map((doc) => ({
            ...doc,
            days_left: doc.days_left !== null ? Number(doc.days_left) : null,
          }))
        );

        const resVehicles = await fetch(apiUrl("/api/vehicles"), {
          signal: controller.signal,
        });
        if (!resVehicles.ok) throw new Error("Araçlar API hatası");
        const dataVehicles = (await resVehicles.json()) as Vehicle[];
        setVehicles(dataVehicles);

        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.error(err);
        setError("Belgeler veya araçlar çekilirken hata oluştu");
      } finally {
        setLoading(false);
      }
    };

    fetchDocsAndVehicles();
    return () => controller.abort();
  }, []);

  const openVehicleDetails = async (vehicle: Vehicle) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    try {
      // Lazy-load fresh data to include documents
      const res = await fetch(apiUrl(`/api/vehicles?q=${encodeURIComponent(vehicle.plate)}`));
      if (!res.ok) throw new Error("Araç detayları alınamadı");
      const list = (await res.json()) as Vehicle[];
      const match = list.find(v => v.id === vehicle.id || v.plate === vehicle.plate);
      if (!match) throw new Error("Araç bulunamadı");
      const docs = (match.documents ?? []) as unknown as UpcomingDocument[];
      setSelectedVehicle({ ...match, documents: docs });
    } catch (e) {
      console.error(e);
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <section className="space-y-6 px-3 sm:px-4 md:px-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold">Belge Takip Panosu</h2>
          <p className="text-sm text-slate-400">Önümüzdeki 60 gün içinde süresi dolacak belgeler</p>
        </div>
        <span className="self-start sm:self-auto rounded bg-slate-800 px-3 py-1 text-xs sm:text-sm text-slate-300">
          {loading ? "Yükleniyor..." : `${docs.length} belge`}
        </span>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-900/40 p-3 sm:p-4 text-xs sm:text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        {docs.length === 0 && !loading ? (
          <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">
            Önümüzdeki 60 gün içinde süresi dolacak belge bulunmuyor.
          </p>
        ) : (
          docs.map((doc) => (
            <article
              key={doc.id ?? doc.doc_id}
              className={`rounded-xl border shadow-lg shadow-slate-900/40 transition hover:-translate-y-1 hover:shadow-slate-800/60 focus-within:ring-1 ring-white/10 ${statusClass(doc.status)} `}
            >
              <div className="space-y-2.5 p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm uppercase tracking-wide text-white/70">Plaka</span>
                  <span className="text-base sm:text-lg font-semibold text-white break-words">{doc.plate}</span>
                </div>
                <div>
                  <span className="text-sm uppercase tracking-wide text-white/70">Belge Türü</span>
                  <h3 className="text-lg sm:text-xl font-semibold capitalize text-white break-words">{doc.doc_type.replace(/_/g, " ")}</h3>
                </div>
                {doc.valid_from ? (
                  <div className="flex items-center justify-between text-xs text-white/70">
                    <span>Geçerlilik Başlangıcı</span>
                    <span>{new Date(doc.valid_from).toLocaleDateString("tr-TR")}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between text-sm sm:text-base text-white/80">
                  <span>Bitiş Tarihi</span>
                  <span>{new Date(doc.valid_to).toLocaleDateString("tr-TR")}</span>
                </div>
                <div className="flex items-center justify-between text-sm sm:text-base font-medium text-white">
                  <span>Kalan Gün</span>
                  <span>{doc.days_left ?? "-"}</span>
                </div>
                {doc.note ? (
                  <p className="text-xs sm:text-sm text-white/70 break-words">Not: {doc.note}</p>
                ) : null}
                <div className="text-xs sm:text-sm text-white/70 break-all">
                  Sorumlu: {doc.responsible_email ?? "Tanımlı değil"}
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="pt-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-xl sm:text-2xl font-semibold">Araçlar</h2>
          <span className="self-start sm:self-auto rounded bg-slate-800 px-3 py-1 text-xs sm:text-sm text-slate-300">
            {loading ? "Yükleniyor..." : `${vehicles.length} araç`}
          </span>
        </div>

        {vehicles.length === 0 && !loading ? (
          <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">
            Kayıtlı araç bulunmamaktadır.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
            {vehicles.map((vehicle) => (
              <article
                key={vehicle.id}
                className="rounded-xl border border-slate-700 shadow-lg shadow-slate-900/40 transition hover:-translate-y-1 hover:shadow-slate-800/60 focus-within:ring-1 ring-white/10 bg-slate-800/80 cursor-pointer"
                onClick={() => openVehicleDetails(vehicle)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") openVehicleDetails(vehicle); }}
              >
                <div className="space-y-2.5 p-4 sm:p-5 text-white">
                  <div className="text-lg sm:text-xl font-semibold break-words">{vehicle.plate}</div>
                  {(vehicle.make || vehicle.model || vehicle.year) && (
                    <div className="text-sm sm:text-base text-white/70 capitalize break-words">
                      {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs sm:text-sm text-white/70 pt-2">
                    <span>Belge Sayısı</span>
                    <span>{vehicle.document_count}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs sm:text-sm text-white/70">
                    <span>Kayıt Tarihi</span>
                    <span>{new Date(vehicle.created_at).toLocaleDateString("tr-TR")}</span>
                  </div>
                  <div className="pt-2 text-[11px] sm:text-xs text-white/60">Detay için tıklayın</div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => { setDetailOpen(false); setSelectedVehicle(null); }}
          />
          <div className="relative z-10 w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6 mx-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold text-white">
                  {selectedVehicle ? selectedVehicle.plate : "Araç Detayı"}
                </h3>
                {selectedVehicle && (
                  <p className="text-sm text-white/70">
                    {[selectedVehicle.make, selectedVehicle.model, selectedVehicle.year].filter(Boolean).join(" ")}
                  </p>
                )}
              </div>
              <button
                className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:border-slate-400 hover:text-white"
                onClick={() => { setDetailOpen(false); setSelectedVehicle(null); }}
              >
                Kapat
              </button>
            </div>

            {detailLoading ? (
              <p className="mt-4 text-slate-300 text-sm">Detaylar yükleniyor...</p>
            ) : detailError ? (
              <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-900/40 p-3 text-sm text-rose-100">
                {detailError}
              </p>
            ) : selectedVehicle ? (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-white/80">
                    <div className="text-white/60">Kayıt Tarihi</div>
                    <div className="font-medium text-white">{new Date(selectedVehicle.created_at).toLocaleString("tr-TR")}</div>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-white/80">
                    <div className="text-white/60">Belge Sayısı</div>
                    <div className="font-medium text-white">{selectedVehicle.document_count}</div>
                  </div>
                </div>

                <h4 className="text-base sm:text-lg font-semibold text-white">Belgeler</h4>
                {(!selectedVehicle.documents || selectedVehicle.documents.length === 0) ? (
                  <p className="text-sm text-slate-300">Bu araç için kayıtlı belge bulunmuyor.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedVehicle.documents.map((doc) => (
                      <div
                        key={`${selectedVehicle.id}-${doc.id}`}
                        className={`rounded-lg border p-3 ${statusClass(doc.status)}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold capitalize text-white">
                            {doc.doc_type.replace(/_/g, " ")}
                          </div>
                          <div className="text-xs text-white/80">{formatDaysLabel(doc.days_left)}</div>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-white/80">
                          <div>
                            <div className="text-white/60">Başlangıç</div>
                            <div>{doc.valid_from ? new Date(doc.valid_from).toLocaleDateString("tr-TR") : "-"}</div>
                          </div>
                          <div>
                            <div className="text-white/60">Bitiş</div>
                            <div>{doc.valid_to ? new Date(doc.valid_to).toLocaleDateString("tr-TR") : "-"}</div>
                          </div>
                        </div>
                        {doc.note ? (
                          <div className="mt-1 text-xs text-white/70 break-words">Not: {doc.note}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
