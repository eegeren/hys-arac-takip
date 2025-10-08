"use client";
import { apiUrl } from "../lib/api";

import { useEffect, useState } from "react";
import React from "react";

// Basit etiket dönüştürücü (TR)
const DOC_LABELS: Record<string, string> = {
  inspection: "Muayene",
  muayene: "Muayene",
  k_document: "K Belgesi",
  k: "K Belgesi",
  k_belgesi: "K Belgesi",
  traffic_insurance: "Trafik Sigortası",
  insurance: "Trafik Sigortası",
  trafik_sigortası: "Trafik Sigortası",
  kasko: "Kasko",
};
const docTypeLabel = (v: string) => DOC_LABELS[(v || "").toLowerCase().replace(/\s+/g, "_")] || v?.replace(/_/g, " ") || "-";

const normalizeType = (v: string) => (v || "").toLowerCase().replace(/\s+/g, "_");
const ALL_TYPES = Array.from(new Set(Object.keys(DOC_LABELS).map(k => normalizeType(k)).concat([
  "inspection","k_document","traffic_insurance","kasko","service_oil","service_general"
])));

// Küçük rozet bileşeni
function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

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
      return "bg-gradient-to-br from-rose-700/80 to-rose-600/70 border-rose-300/60 ring-1 ring-rose-200/30";
    case "warning":
      return "bg-gradient-to-br from-amber-700/70 to-amber-600/70 border-amber-300/60 ring-1 ring-amber-200/30";
    case "ok":
      return "bg-gradient-to-br from-emerald-700/70 to-emerald-600/70 border-emerald-300/60 ring-1 ring-emerald-200/30";
    case "expired":
      return "bg-gradient-to-br from-rose-900/80 to-rose-800/70 border-rose-400/60 ring-1 ring-rose-300/20";
    default:
      return "bg-slate-800/80 border-slate-600/60 ring-1 ring-white/5";
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
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareType, setCompareType] = useState<string | null>(null);

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

  const openCompareFor = (type: string) => {
    const t = normalizeType(type);
    setCompareType(t);
    setCompareOpen(true);
  };

  const comparison = React.useMemo(() => {
    if (!compareType) return { have: [] as Vehicle[], missing: [] as Vehicle[] };
    const have: Vehicle[] = [];
    const missing: Vehicle[] = [];
    for (const v of vehicles) {
      const docsArr = (v.documents ?? []) as any[];
      const hasIt = docsArr.some(d => normalizeType(d.doc_type) === compareType);
      (hasIt ? have : missing).push(v);
    }
    return { have, missing };
  }, [compareType, vehicles]);

  return (
    <section className="space-y-6 px-3 sm:px-4 md:px-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">Belge Takip Panosu</h2>
          <p className="text-sm text-slate-400">Önümüzdeki 60 gün içinde süresi dolacak belgeler</p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(["inspection","traffic_insurance","k_document","kasko","service_oil","service_general"] as const).map(t => (
              <button
                key={t}
                onClick={() => openCompareFor(t)}
                className="rounded-full border border-slate-600/60 bg-slate-800/70 px-3 py-1 text-xs text-slate-200 hover:border-slate-400 hover:text-white whitespace-nowrap"
              >
                {docTypeLabel(t)} karşılaştır
              </button>
            ))}
          </div>
        </div>
        <Badge className="self-start sm:self-auto border-slate-600/60 bg-slate-800/70 text-slate-200">
          {loading ? "Yükleniyor..." : `${docs.length} belge`}
        </Badge>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-900/40 p-3 sm:p-4 text-xs sm:text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 sm:p-5 animate-pulse">
              <div className="h-4 w-24 bg-slate-700/70 rounded" />
              <div className="mt-3 h-6 w-40 bg-slate-700/70 rounded" />
              <div className="mt-4 h-3 w-full bg-slate-700/70 rounded" />
              <div className="mt-2 h-3 w-1/2 bg-slate-700/70 rounded" />
            </div>
          ))
        ) : docs.length === 0 ? (
          <p className="col-span-full rounded-xl border border-slate-700 bg-slate-800/70 p-6 text-center text-slate-300">
            Önümüzdeki 60 gün içinde süresi dolacak belge bulunmuyor.
          </p>
        ) : (
          docs.map((doc) => (
            <article
              key={doc.id ?? doc.doc_id}
              className={`group rounded-xl border shadow-lg shadow-slate-900/40 transition hover:-translate-y-1 hover:shadow-slate-800/60 focus-within:ring-2 ring-white/10 ${statusClass(doc.status)}`}
            >
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge className="border-white/20 bg-black/10 text-white/90">{doc.plate}</Badge>
                  <Badge className="border-white/20 bg-black/10 text-white/90">{formatDaysLabel(doc.days_left)}</Badge>
                </div>
                <h3
                  className="mt-3 text-lg sm:text-xl font-semibold text-white capitalize break-words underline decoration-dotted underline-offset-4 cursor-pointer"
                  onClick={() => openCompareFor(doc.doc_type)}
                  title="Bu belge türü için hangi araçlarda var/yok karşılaştır"
                >
                  {docTypeLabel(doc.doc_type)}
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:text-sm text-white/85">
                  {doc.valid_from ? (
                    <div className="flex items-center justify-between">
                      <span className="text-white/70">Başlangıç</span>
                      <span>{new Date(doc.valid_from).toLocaleDateString("tr-TR")}</span>
                    </div>
                  ) : (
                    <div />
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-white/70">Bitiş</span>
                    <span>{new Date(doc.valid_to).toLocaleDateString("tr-TR")}</span>
                  </div>
                </div>
                {doc.note ? (
                  <p className="mt-2 text-xs sm:text-sm text-white/80 break-words">Not: {doc.note}</p>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      <div className="pt-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-2xl sm:text-3xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">Araçlar</h2>
          <Badge className="self-start sm:self-auto border-slate-600/60 bg-slate-800/70 text-slate-200">
            {loading ? "Yükleniyor..." : `${vehicles.length} araç`}
          </Badge>
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
                  <div className="flex items-center justify-between">
                    <div className="text-lg sm:text-xl font-semibold break-words">{vehicle.plate}</div>
                    <Badge className="border-white/15 bg-black/10 text-white/90">{vehicle.document_count} belge</Badge>
                  </div>
                  {(vehicle.make || vehicle.model || vehicle.year) && (
                    <div className="text-sm sm:text-base text-white/70 capitalize break-words">
                      {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs sm:text-sm text-white/70 pt-2">
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
      {compareOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setCompareOpen(false); setCompareType(null); }} />
          <div className="relative z-10 w-full sm:max-w-3xl max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 p-4 sm:p-6 mx-auto shadow-xl shadow-black/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold text-white">Karşılaştırma</h3>
                <p className="text-sm text-white/70">Belge türü: <span className="font-medium text-white">{compareType ? docTypeLabel(compareType) : "-"}</span></p>
              </div>
              <button
                className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:border-slate-400 hover:text-white"
                onClick={() => { setCompareOpen(false); setCompareType(null); }}
              >
                Kapat
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-emerald-600/40 bg-emerald-900/20 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm sm:text-base font-semibold text-emerald-200">Bu belge VAR</h4>
                  <Badge className="border-emerald-300/40 bg-emerald-800/30 text-emerald-100">{comparison.have.length}</Badge>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-white/90 max-h-64 overflow-y-auto pr-1">
                  {comparison.have.length === 0 ? (
                    <li className="text-white/60">Hiç araç yok</li>
                  ) : (
                    comparison.have.map(v => (
                      <li key={`have-${v.id}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{v.plate}</span>
                        <button
                          onClick={() => { setCompareOpen(false); openVehicleDetails(v); }}
                          className="text-xs underline decoration-dotted hover:text-white/90"
                        >
                          detay
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="rounded-lg border border-rose-600/40 bg-rose-900/20 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm sm:text-base font-semibold text-rose-200">Bu belge YOK</h4>
                  <Badge className="border-rose-300/40 bg-rose-800/30 text-rose-100">{comparison.missing.length}</Badge>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-white/90 max-h-64 overflow-y-auto pr-1">
                  {comparison.missing.length === 0 ? (
                    <li className="text-white/60">Tüm araçlarda mevcut</li>
                  ) : (
                    comparison.missing.map(v => (
                      <li key={`missing-${v.id}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{v.plate}</span>
                        <button
                          onClick={() => { setCompareOpen(false); openVehicleDetails(v); }}
                          className="text-xs underline decoration-dotted hover:text-white/90"
                        >
                          detay
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>

            <div className="mt-4 text-xs text-white/60">
              İpucu: Üstteki belgeler bölümünde belge başlığına tıklayarak da bu görünümü açabilirsiniz.
            </div>
          </div>
        </div>
      )}

      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => { setDetailOpen(false); setSelectedVehicle(null); }}
          />
          <div className="relative z-10 w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 p-4 sm:p-6 mx-auto shadow-xl shadow-black/40">
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
                            {docTypeLabel(doc.doc_type)}
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
