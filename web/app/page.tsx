"use client";
import { apiUrl } from "../lib/api";

import React, { useEffect, useState } from "react";

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

const docTypeLabel = (value: string) =>
  DOC_LABELS[(value || "").toLowerCase().replace(/\s+/g, "_")] || value?.replace(/_/g, " ") || "-";

const normalizeType = (value: string) => (value || "").toLowerCase().replace(/\s+/g, "_");
const ALL_TYPES = Array.from(
  new Set(
    Object.keys(DOC_LABELS)
      .map((key) => normalizeType(key))
      .concat(["inspection", "k_document", "traffic_insurance", "kasko", "service_oil", "service_general"]),
  ),
);

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

type SummaryCard = {
  key: string;
  title: string;
  value: number;
  description: string;
  gradient: string;
  textClass: string;
  borderClass: string;
  footer?: string;
};

type DocOverview = {
  total: number;
  critical: number;
  warning: number;
  ok: number;
  expired: number;
  dueThisWeek: number;
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
      return "bg-gradient-to-br from-slate-800/80 to-slate-900/70 border-slate-500/60 ring-1 ring-slate-300/20";
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

const DOC_STATUS_META: Record<"critical" | "warning" | "ok" | "expired", { label: string; description: string }> = {
  critical: { label: "Kritik", description: "7 gün içinde doluyor" },
  warning: { label: "Yaklaşıyor", description: "30 gün içinde doluyor" },
  ok: { label: "Takvimde", description: "Uyumluluk içinde" },
  expired: { label: "Süresi Dolmuş", description: "Geçmiş belgeler" },
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

  const docOverview = React.useMemo<DocOverview>(() => {
    const totals: DocOverview = {
      total: docs.length,
      critical: 0,
      warning: 0,
      ok: 0,
      expired: 0,
      dueThisWeek: 0,
    };
    for (const doc of docs) {
      if (doc.status === "critical") totals.critical += 1;
      else if (doc.status === "warning") totals.warning += 1;
      else if (doc.status === "ok") totals.ok += 1;
      else if (doc.status === "expired") totals.expired += 1;

      if (doc.days_left !== null && doc.days_left !== undefined && doc.days_left >= 0 && doc.days_left <= 7) {
        totals.dueThisWeek += 1;
      }
    }
    return totals;
  }, [docs]);

  const vehicleOverview = React.useMemo(() => {
    if (vehicles.length === 0) {
      return { avgDocs: 0, withDocs: 0 };
    }
    let totalDocs = 0;
    let withDocs = 0;
    for (const vehicle of vehicles) {
      totalDocs += vehicle.document_count;
      if (vehicle.document_count > 0) {
        withDocs += 1;
      }
    }
    return {
      avgDocs: totalDocs / vehicles.length,
      withDocs,
    };
  }, [vehicles]);

  const summaryCards = React.useMemo<SummaryCard[]>(
    () => [
      {
        key: "upcoming",
        title: "Yaklaşan Belgeler",
        value: docOverview.total,
        description: "Önümüzdeki 60 gün içinde yenilenmesi gereken belge",
        gradient: "from-sky-500/80 to-sky-600/80",
        textClass: "text-sky-50",
        borderClass: "border-sky-300/60",
      },
      {
        key: "week",
        title: "Bu Hafta Takip",
        value: docOverview.dueThisWeek,
        description: "7 gün içinde bildirim bekleyen belge",
        gradient: "from-violet-500/80 to-indigo-500/80",
        textClass: "text-indigo-50",
        borderClass: "border-indigo-300/60",
      },
      {
        key: "critical",
        title: DOC_STATUS_META.critical.label,
        value: docOverview.critical,
        description: DOC_STATUS_META.critical.description,
        gradient: "from-rose-500/90 to-rose-600/80",
        textClass: "text-rose-50",
        borderClass: "border-rose-300/60",
      },
      {
        key: "vehicles",
        title: "Araçlar",
        value: vehicles.length,
        description: `${vehicleOverview.withDocs} araçta aktif belge var`,
        gradient: "from-emerald-500/80 to-teal-500/80",
        textClass: "text-emerald-50",
        borderClass: "border-emerald-300/60",
        footer: `Araç başına ortalama ${Number.isFinite(vehicleOverview.avgDocs) ? vehicleOverview.avgDocs.toFixed(1) : "0"} belge`,
      },
    ],
    [docOverview.total, docOverview.dueThisWeek, docOverview.critical, vehicleOverview.avgDocs, vehicleOverview.withDocs, vehicles.length],
  );

  useEffect(() => {
    const controller = new AbortController();

    const fetchDocsAndVehicles = async () => {
      try {
        const resDocs = await fetch(apiUrl("/api/documents/upcoming?days=60"), { signal: controller.signal });
        if (!resDocs.ok) throw new Error("API hatası");
        const dataDocs = (await resDocs.json()) as UpcomingDocument[];
        setDocs(
          dataDocs.map((doc) => ({
            ...doc,
            days_left: doc.days_left !== null ? Number(doc.days_left) : null,
          })),
        );

        const resVehicles = await fetch(apiUrl("/api/vehicles"), { signal: controller.signal });
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
      const res = await fetch(apiUrl(`/api/vehicles?q=${encodeURIComponent(vehicle.plate)}`));
      if (!res.ok) throw new Error("Araç detayları alınamadı");
      const list = (await res.json()) as Vehicle[];
      const match = list.find((item) => item.id === vehicle.id || item.plate === vehicle.plate);
      if (!match) throw new Error("Araç bulunamadı");
      const vehicleDocs = (match.documents ?? []) as unknown as UpcomingDocument[];
      setSelectedVehicle({ ...match, documents: vehicleDocs });
    } catch (e) {
      console.error(e);
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const openCompareFor = (type: string) => {
    const normalized = normalizeType(type);
    if (!ALL_TYPES.includes(normalized)) {
      ALL_TYPES.push(normalized);
    }
    setCompareType(normalized);
    setCompareOpen(true);
  };

  const comparison = React.useMemo(() => {
    if (!compareType) return { have: [] as Vehicle[], missing: [] as Vehicle[] };
    const have: Vehicle[] = [];
    const missing: Vehicle[] = [];
    for (const vehicle of vehicles) {
      const docsArr = (vehicle.documents ?? []) as any[];
      const hasIt = docsArr.some((doc) => normalizeType(doc.doc_type) === compareType);
      (hasIt ? have : missing).push(vehicle);
    }
    return { have, missing };
  }, [compareType, vehicles]);

  return (
    <main className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.08),_transparent_60%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-32 -z-10 h-1/3 bg-[radial-gradient(circle_at_center,_rgba(236,72,153,0.06),_transparent_65%)]" aria-hidden />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-3 py-8 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.95)] backdrop-blur md:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400/90">Gösterge Paneli</p>
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Belge Takip Panosu</h1>
              <p className="text-sm text-slate-300 max-w-xl">
                Araç belgelerinin güncel durumunu tek bakışta takip edin. Uyarı eşikleri otomatik olarak sabah 08:00’de kontrol edilir.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 text-left sm:items-end sm:text-right">
              <Badge className="border-slate-500/40 bg-slate-800/80 px-3 py-1 text-sm text-slate-50">
                {loading ? "Yükleniyor..." : `${docOverview.total} belge`}
              </Badge>
              <span className="text-xs text-slate-400">
                Bu hafta bildirim bekleyen <span className="font-semibold text-slate-100">{docOverview.dueThisWeek}</span> belge
              </span>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 sm:justify-between">
            <span className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Hızlı karşılaştır</span>
            <div className="flex w-full gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(["inspection", "traffic_insurance", "k_document", "kasko", "service_oil", "service_general"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => openCompareFor(type)}
                  className="inline-flex flex-none items-center justify-center rounded-full border border-slate-600/60 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-slate-300 hover:text-white"
                >
                  {docTypeLabel(type)}
                </button>
              ))}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div
              key={card.key}
              className={`relative overflow-hidden rounded-2xl border ${card.borderClass} bg-slate-900/80 shadow-[0_25px_60px_-40px_rgba(15,23,42,0.95)]`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-80`} aria-hidden />
              <div className="relative flex h-full flex-col justify-between gap-3 p-5">
                <div className="text-xs font-medium uppercase tracking-[0.3em] text-white/80">{card.title}</div>
                <div className={`text-3xl font-semibold tracking-tight ${card.textClass}`}>{card.value}</div>
                <p className="text-xs text-white/80">{card.description}</p>
                {card.footer ? <p className="text-[11px] text-white/70">{card.footer}</p> : null}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white sm:text-3xl">Belge Durumu</h2>
              <p className="text-sm text-slate-300">Önümüzdeki 60 gün içinde yaklaşan belgeler ve durum dağılımı</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["critical", "warning", "ok"] as Array<keyof Pick<DocOverview, "critical" | "warning" | "ok">>).map((status) => (
                <Badge key={status} className="border-slate-600/60 bg-slate-800/80 text-slate-200">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      status === "critical" ? "bg-rose-400" : status === "warning" ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                  />
                  {DOC_STATUS_META[status].label}
                  <span className="font-semibold text-white/90">{docOverview[status]}</span>
                </Badge>
              ))}
            </div>
          </div>

          {error ? <p className="rounded-xl border border-rose-500/40 bg-rose-900/40 p-4 text-sm text-rose-100">{error}</p> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={`doc-skeleton-${index}`}
                    className="h-full rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-inner shadow-slate-950/40"
                  >
                    <div className="h-4 w-32 animate-pulse rounded bg-slate-700/70" />
                    <div className="mt-4 h-6 w-40 animate-pulse rounded bg-slate-700/60" />
                    <div className="mt-6 h-3 w-full animate-pulse rounded bg-slate-700/50" />
                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-slate-700/40" />
                  </div>
                ))
              : docs.length === 0
              ? (
                  <p className="col-span-full rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 text-center text-slate-300">
                    Önümüzdeki 60 gün içinde süresi dolacak belge bulunmuyor.
                  </p>
                )
              : docs.map((doc) => (
                  <article
                    key={doc.id ?? doc.doc_id}
                    className={`group flex h-full flex-col justify-between rounded-2xl border transition duration-200 hover:-translate-y-1 hover:shadow-[0_30px_60px_-45px_rgba(15,23,42,0.95)] ${statusClass(
                      doc.status,
                    )}`}
                  >
                    <div className="flex flex-col gap-4 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <Badge className="border-white/20 bg-black/15 text-white/90">{doc.plate}</Badge>
                        <Badge className="border-white/20 bg-black/15 text-white/90">{formatDaysLabel(doc.days_left)}</Badge>
                      </div>
                      <button
                        className="text-left text-lg font-semibold capitalize text-white underline decoration-dotted underline-offset-4 hover:text-white"
                        onClick={() => openCompareFor(doc.doc_type)}
                        title="Bu belge türü için hangi araçlarda var/yok karşılaştır"
                      >
                        {docTypeLabel(doc.doc_type)}
                      </button>
                      <div className="grid grid-cols-1 gap-3 text-sm text-white/85 sm:grid-cols-2">
                        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs sm:text-sm">
                          <span className="text-white/60">Başlangıç</span>
                          <span>{doc.valid_from ? new Date(doc.valid_from).toLocaleDateString("tr-TR") : "-"}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs sm:text-sm">
                          <span className="text-white/60">Bitiş</span>
                          <span>{new Date(doc.valid_to).toLocaleDateString("tr-TR")}</span>
                        </div>
                      </div>
                      {doc.note ? (
                        <p className="rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-white/80 sm:text-sm">
                          <span className="font-medium text-white/70">Not: </span>
                          {doc.note}
                        </p>
                      ) : null}
                      {doc.responsible_email ? (
                        <p className="text-xs text-white/60">
                          Sorumlu: <span className="font-medium text-white/80">{doc.responsible_email}</span>
                        </p>
                      ) : null}
                    </div>
                  </article>
                ))}
          </div>
        </section>

        <section className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white sm:text-3xl">Araçlar</h2>
              <p className="text-sm text-slate-300">Araçlara ait temel bilgiler ve belge adetleri</p>
            </div>
            <Badge className="border-slate-600/60 bg-slate-800/80 text-slate-200">
              {loading ? "Yükleniyor..." : `${vehicles.length} araç`}
            </Badge>
          </div>

          {vehicles.length === 0 && !loading ? (
            <p className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 text-slate-300">Kayıtlı araç bulunmamaktadır.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {vehicles.map((vehicle) => (
                <article
                  key={vehicle.id}
                  className="group cursor-pointer rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.9)] transition hover:-translate-y-1 hover:shadow-[0_35px_80px_-45px_rgba(15,23,42,0.95)]"
                  onClick={() => openVehicleDetails(vehicle)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") openVehicleDetails(vehicle);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold text-white">{vehicle.plate}</h3>
                      {(vehicle.make || vehicle.model || vehicle.year) && (
                        <p className="mt-1 text-sm text-slate-300">
                          {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}
                        </p>
                      )}
                    </div>
                    <Badge className="border-white/15 bg-black/10 text-white/90">{vehicle.document_count} belge</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <span className="rounded-full border border-slate-700/70 px-3 py-1">
                      Kayıt: {new Date(vehicle.created_at).toLocaleDateString("tr-TR")}
                    </span>
                    <span className="rounded-full border border-slate-700/70 px-3 py-1">
                      Durum: {vehicle.document_count > 0 ? "Belgeli" : "Eksik"}
                    </span>
                  </div>
                  <p className="mt-4 text-[11px] text-slate-400 transition group-hover:text-slate-200">Detay görmek için tıklayın</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {compareOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setCompareOpen(false); setCompareType(null); }} />
          <div className="relative z-10 w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 p-5 shadow-xl shadow-black/40 sm:max-w-3xl sm:rounded-2xl sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white sm:text-xl">Karşılaştırma</h3>
                <p className="text-sm text-white/70">
                  Belge türü: <span className="font-medium text-white">{compareType ? docTypeLabel(compareType) : "-"}</span>
                </p>
              </div>
              <button
                className="self-end rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200 transition hover:border-slate-300 hover:text-white"
                onClick={() => { setCompareOpen(false); setCompareType(null); }}
              >
                Kapat
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-600/40 bg-emerald-900/20 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-emerald-200 sm:text-base">Bu belge VAR</h4>
                  <Badge className="border-emerald-300/40 bg-emerald-800/30 text-emerald-100">{comparison.have.length}</Badge>
                </div>
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1 text-sm text-white/90">
                  {comparison.have.length === 0 ? (
                    <li className="text-white/60">Hiç araç yok</li>
                  ) : (
                    comparison.have.map((vehicle) => (
                      <li key={`have-${vehicle.id}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{vehicle.plate}</span>
                        <button
                          onClick={() => {
                            setCompareOpen(false);
                            openVehicleDetails(vehicle);
                          }}
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
                  <h4 className="text-sm font-semibold text-rose-200 sm:text-base">Bu belge YOK</h4>
                  <Badge className="border-rose-300/40 bg-rose-800/30 text-rose-100">{comparison.missing.length}</Badge>
                </div>
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1 text-sm text-white/90">
                  {comparison.missing.length === 0 ? (
                    <li className="text-white/60">Tüm araçlarda mevcut</li>
                  ) : (
                    comparison.missing.map((vehicle) => (
                      <li key={`missing-${vehicle.id}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{vehicle.plate}</span>
                        <button
                          onClick={() => {
                            setCompareOpen(false);
                            openVehicleDetails(vehicle);
                          }}
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
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setDetailOpen(false); setSelectedVehicle(null); }} />
          <div className="relative z-10 w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 p-5 shadow-xl shadow-black/40 sm:max-w-2xl sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white sm:text-xl">
                  {selectedVehicle ? selectedVehicle.plate : "Araç Detayı"}
                </h3>
                {selectedVehicle ? (
                  <p className="text-sm text-white/70">
                    {[selectedVehicle.make, selectedVehicle.model, selectedVehicle.year].filter(Boolean).join(" ")}
                  </p>
                ) : null}
              </div>
              <button
                className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200 transition hover:border-slate-300 hover:text-white"
                onClick={() => {
                  setDetailOpen(false);
                  setSelectedVehicle(null);
                }}
              >
                Kapat
              </button>
            </div>

            {detailLoading ? (
              <p className="mt-4 text-sm text-slate-300">Detaylar yükleniyor...</p>
            ) : detailError ? (
              <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-900/40 p-3 text-sm text-rose-100">{detailError}</p>
            ) : selectedVehicle ? (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-white/80">
                    <div className="text-white/60">Kayıt Tarihi</div>
                    <div className="font-medium text-white">{new Date(selectedVehicle.created_at).toLocaleString("tr-TR")}</div>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-white/80">
                    <div className="text-white/60">Belge Sayısı</div>
                    <div className="font-medium text-white">{selectedVehicle.document_count}</div>
                  </div>
                </div>

                <h4 className="text-base font-semibold text-white sm:text-lg">Belgeler</h4>
                {!selectedVehicle.documents || selectedVehicle.documents.length === 0 ? (
                  <p className="text-sm text-slate-300">Bu araç için kayıtlı belge bulunmuyor.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedVehicle.documents.map((doc) => (
                      <div key={`${selectedVehicle.id}-${doc.id}`} className={`rounded-lg border p-3 ${statusClass(doc.status)}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold capitalize text-white">{docTypeLabel(doc.doc_type)}</div>
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
                        {doc.note ? <div className="mt-1 text-xs text-white/70 break-words">Not: {doc.note}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
