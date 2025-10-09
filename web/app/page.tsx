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
  responsible_email: string | null;
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

type DocumentUploadEntry = {
  id: string;
  plate: string;
  docType: string;
  note: string;
  fileName: string;
  uploadedAt: string;
};

type DamageEntry = {
  id: string;
  plate: string;
  title: string;
  description: string;
  severity: "Hafif" | "Orta" | "Ağır";
  occurredAt: string;
};

type ExpenseEntry = {
  id: string;
  plate: string;
  category: string;
  amount: number;
  description: string;
  createdAt: string;
};

type UploadFormState = {
  plate: string;
  docType: string;
  note: string;
  file: File | null;
};

type DamageFormState = {
  plate: string;
  title: string;
  description: string;
  severity: DamageEntry["severity"];
  occurredAt: string;
};

type ExpenseFormState = {
  plate: string;
  category: string;
  amount: string;
  description: string;
  createdAt: string;
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

const statusColor = (status: string) => {
  switch (status) {
    case "critical":
      return "bg-rose-500";
    case "warning":
      return "bg-amber-400";
    case "ok":
      return "bg-emerald-400";
    case "expired":
      return "bg-slate-500";
    default:
      return "bg-slate-500";
  }
};

const statusMeta = (status: string) =>
  DOC_STATUS_META[status as keyof typeof DOC_STATUS_META] ?? { label: "Durum", description: "" };

const DAMAGE_SEVERITIES: Array<DamageEntry["severity"]> = ["Hafif", "Orta", "Ağır"];
const EXPENSE_CATEGORIES = [
  "Bakım",
  "Onarım",
  "Sigorta",
  "Vergi",
  "Yakıt",
  "Diğer",
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value);

const normalizePlateInput = (value: string) => value.trim().toUpperCase();

const flashMessage = (
  setter: React.Dispatch<React.SetStateAction<string | null>>,
  message: string,
  timeout = 3500,
) => {
  setter(message);
  setTimeout(() => setter(null), timeout);
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
  const [vehicleFilter, setVehicleFilter] = useState<"all" | "withDocs" | "missingDocs">("all");
  const [uploadForm, setUploadForm] = useState<UploadFormState>({
    plate: "",
    docType: "",
    note: "",
    file: null,
  });
  const [uploadLog, setUploadLog] = useState<DocumentUploadEntry[]>([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadFileKey, setUploadFileKey] = useState<number>(() => Date.now());
  const [damageForm, setDamageForm] = useState<DamageFormState>({
    plate: "",
    title: "",
    description: "",
    severity: "Hafif",
    occurredAt: new Date().toISOString().split("T")[0],
  });
  const [damageLog, setDamageLog] = useState<DamageEntry[]>([]);
  const [damageMessage, setDamageMessage] = useState<string | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>({
    plate: "",
    category: "Bakım",
    amount: "",
    description: "",
    createdAt: new Date().toISOString().split("T")[0],
  });
  const [expenseLog, setExpenseLog] = useState<ExpenseEntry[]>([]);
  const [expenseMessage, setExpenseMessage] = useState<string | null>(null);

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

  const filteredVehicles = React.useMemo(() => {
    if (vehicleFilter === "withDocs") {
      return vehicles.filter((vehicle) => vehicle.document_count > 0);
    }
    if (vehicleFilter === "missingDocs") {
      return vehicles.filter((vehicle) => vehicle.document_count === 0);
    }
    return vehicles;
  }, [vehicleFilter, vehicles]);

  const vehicleFilterLabel = (value: "all" | "withDocs" | "missingDocs") => {
    if (value === "withDocs") return "Belgeli";
    if (value === "missingDocs") return "Eksik";
    return "Tümü";
  };

  const totalExpense = React.useMemo(() => {
    return expenseLog.reduce((sum, item) => sum + item.amount, 0);
  }, [expenseLog]);

  const handleUploadSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!uploadForm.plate.trim() || !uploadForm.docType.trim() || !uploadForm.file) {
      flashMessage(setUploadMessage, "Lütfen plaka, belge türü ve dosya seçin.");
      return;
    }
    const newEntry: DocumentUploadEntry = {
      id: crypto.randomUUID(),
      plate: normalizePlateInput(uploadForm.plate),
      docType: uploadForm.docType,
      note: uploadForm.note.trim(),
      fileName: uploadForm.file.name,
      uploadedAt: new Date().toISOString(),
    };
    setUploadLog((prev) => [newEntry, ...prev].slice(0, 12));
    flashMessage(setUploadMessage, "Dosya kaydı listesine eklendi. (Demo)");
    setUploadForm({
      plate: "",
      docType: "",
      note: "",
      file: null,
    });
    setUploadFileKey(Date.now());
  };

  const handleDamageSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!damageForm.plate.trim() || !damageForm.title.trim()) {
      flashMessage(setDamageMessage, "Plaka ve başlık alanları zorunludur.");
      return;
    }
    const newEntry: DamageEntry = {
      id: crypto.randomUUID(),
      plate: normalizePlateInput(damageForm.plate),
      title: damageForm.title.trim(),
      description: damageForm.description.trim(),
      severity: damageForm.severity,
      occurredAt: damageForm.occurredAt,
    };
    setDamageLog((prev) => [newEntry, ...prev].slice(0, 12));
    flashMessage(setDamageMessage, "Hasar kaydı sisteme eklendi. (Demo)");
    setDamageForm({
      plate: "",
      title: "",
      description: "",
      severity: damageForm.severity,
      occurredAt: new Date().toISOString().split("T")[0],
    });
  };

  const handleExpenseSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!expenseForm.plate.trim() || !expenseForm.amount.trim()) {
      flashMessage(setExpenseMessage, "Plaka ve tutar alanları zorunludur.");
      return;
    }
    const numericAmount = Number(expenseForm.amount.replace(",", "."));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      flashMessage(setExpenseMessage, "Tutarı geçerli bir sayı olarak girin.");
      return;
    }
    const newEntry: ExpenseEntry = {
      id: crypto.randomUUID(),
      plate: normalizePlateInput(expenseForm.plate),
      category: expenseForm.category,
      amount: numericAmount,
      description: expenseForm.description.trim(),
      createdAt: expenseForm.createdAt,
    };
    setExpenseLog((prev) => [newEntry, ...prev].slice(0, 12));
    flashMessage(setExpenseMessage, "Masraf kaydı başarıyla eklendi. (Demo)");
    setExpenseForm({
      plate: "",
      category: expenseForm.category,
      amount: "",
      description: "",
      createdAt: new Date().toISOString().split("T")[0],
    });
  };

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

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
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
                    className={`group flex h-full flex-col justify-between overflow-hidden rounded-2xl border transition duration-200 hover:-translate-y-1 hover:shadow-[0_30px_60px_-45px_rgba(15,23,42,0.95)] ${statusClass(
                      doc.status,
                    )}`}
                  >
                    <div className="relative">
                      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-40" />
                      <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-black/20 px-5 py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-white/70">
                            <span className={`h-2.5 w-2.5 rounded-full ${statusColor(doc.status)}`} />
                            {statusMeta(doc.status).label}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className="border-white/15 bg-black/20 text-white/90">{doc.plate}</Badge>
                            <button
                              className="text-left text-base font-semibold capitalize text-white underline decoration-dotted underline-offset-4 hover:text-white"
                              onClick={() => openCompareFor(doc.doc_type)}
                              title="Bu belge türü için hangi araçlarda var/yok karşılaştır"
                            >
                              {docTypeLabel(doc.doc_type)}
                            </button>
                          </div>
                        </div>
                        <div className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs font-medium text-white/80">
                          {formatDaysLabel(doc.days_left)}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-4 px-5 py-5">
                      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-black/15 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
                          <dt className="text-xs uppercase tracking-[0.25em] text-white/60">Başlangıç</dt>
                          <dd className="mt-1 text-sm font-medium text-white">
                            {doc.valid_from ? new Date(doc.valid_from).toLocaleDateString("tr-TR") : "-"}
                          </dd>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/15 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
                          <dt className="text-xs uppercase tracking-[0.25em] text-white/60">Bitiş</dt>
                          <dd className="mt-1 text-sm font-medium text-white">
                            {new Date(doc.valid_to).toLocaleDateString("tr-TR")}
                          </dd>
                        </div>
                      </dl>
                      {doc.note ? (
                        <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
                          <span className="block text-xs uppercase tracking-[0.25em] text-white/60">Not</span>
                          <span className="mt-1 block text-sm">{doc.note}</span>
                        </div>
                      ) : null}
                      {doc.responsible_email ? (
                        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] sm:text-sm">
                          <span>Sorumlu</span>
                          <span className="font-medium text-white/85">{doc.responsible_email}</span>
                        </div>
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
              {loading ? "Yükleniyor..." : `${filteredVehicles.length} araç`}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "withDocs", "missingDocs"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setVehicleFilter(value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  vehicleFilter === value
                    ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-100"
                    : "border-slate-700/70 bg-slate-900/40 text-slate-300 hover:border-slate-500/60 hover:text-white"
                }`}
              >
                {vehicleFilterLabel(value)}
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    value === "withDocs" ? "bg-emerald-400" : value === "missingDocs" ? "bg-rose-400" : "bg-slate-500"
                  }`}
                />
              </button>
            ))}
          </div>

          {filteredVehicles.length === 0 && !loading ? (
            <p className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 text-slate-300">Kayıtlı araç bulunmamaktadır.</p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredVehicles.map((vehicle) => (
                <article
                  key={vehicle.id}
                  className="group cursor-pointer overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/70 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.9)] transition hover:-translate-y-1 hover:shadow-[0_35px_80px_-45px_rgba(15,23,42,0.95)]"
                  onClick={() => openVehicleDetails(vehicle)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") openVehicleDetails(vehicle);
                  }}
                >
                  <div className="border-b border-slate-800/60 bg-gradient-to-r from-slate-900 via-slate-900/80 to-slate-900 px-5 py-4">
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
                  </div>
                  <div className="space-y-4 px-5 py-4">
                    <dl className="grid grid-cols-1 gap-3 text-sm text-slate-200 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-700/70 bg-black/20 px-4 py-3">
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-400">Kayıt Tarihi</dt>
                        <dd className="mt-1 text-sm font-medium text-white">
                          {new Date(vehicle.created_at).toLocaleDateString("tr-TR")}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-slate-700/70 bg-black/20 px-4 py-3">
                        <dt className="text-xs uppercase tracking-[0.25em] text-slate-400">Belge Durumu</dt>
                        <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-white">
                          <span className={`h-2.5 w-2.5 rounded-full ${vehicle.document_count > 0 ? "bg-emerald-400" : "bg-rose-400"}`} />
                          {vehicle.document_count > 0 ? "Belgeli" : "Eksik"}
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="tracking-[0.25em] uppercase">Belge Kapsama</span>
                        <span className="font-semibold text-white/80">
                          {vehicle.document_count}/{ALL_TYPES.length}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800/80">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500 transition-all"
                          style={{ width: `${Math.min((vehicle.document_count / ALL_TYPES.length) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-500">
                      <span className="rounded-full border border-slate-700/70 px-3 py-1">
                        {vehicle.documents?.length ?? vehicle.document_count} kayıtlı belge
                      </span>
                      <span className="rounded-full border border-slate-700/70 px-3 py-1">
                        {vehicle.make ? vehicle.make : "Marka Yok"}
                      </span>
                      {vehicle.model ? (
                        <span className="rounded-full border border-slate-700/70 px-3 py-1">{vehicle.model}</span>
                      ) : null}
                      {vehicle.year ? (
                        <span className="rounded-full border border-slate-700/70 px-3 py-1">{vehicle.year}</span>
                      ) : null}
                    </div>
                    {vehicle.responsible_email ? (
                      <div className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-black/20 px-4 py-2 text-xs text-slate-200 sm:text-sm">
                        <span className="uppercase tracking-[0.25em] text-slate-400">Sorumlu</span>
                        <span className="font-medium text-white/85">{vehicle.responsible_email}</span>
                      </div>
                    ) : null}
                    <p className="text-[11px] text-slate-400 transition group-hover:text-slate-200">Detay görmek için tıklayın</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white sm:text-3xl">Operasyon Yönetimi</h2>
              <p className="text-sm text-slate-300">
                Evrak yükleme, hasar bildirme ve masraf takibini tek yerden yönetin. Veriler demo amaçlı yerelde tutulur.
              </p>
            </div>
            <Badge className="border-slate-600/60 bg-slate-800/80 text-slate-200">
              {uploadLog.length + damageLog.length + expenseLog.length} kayıt
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <form
              className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.95)]"
              onSubmit={handleUploadSubmit}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Belge Yükleme</h3>
                  <p className="text-xs text-slate-400">PDF, JPG, PNG gibi dosyaları kaydedin.</p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/50 bg-emerald-500/20 text-emerald-100">
                  📄
                </span>
              </div>
              <label className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Plaka</label>
              <input
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                placeholder="34 ABC 123"
                value={uploadForm.plate}
                onChange={(event) => setUploadForm((prev) => ({ ...prev, plate: event.target.value }))}
              />
              <label className="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Belge Türü</label>
              <select
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                value={uploadForm.docType}
                onChange={(event) => setUploadForm((prev) => ({ ...prev, docType: event.target.value }))}
              >
                <option value="">Belge seçin</option>
                {ALL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {docTypeLabel(type)}
                  </option>
                ))}
              </select>
              <label className="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Dosya</label>
              <input
                key={uploadFileKey}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                className="mt-1 block w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-500/20 file:px-3 file:py-1 file:text-emerald-100 hover:file:bg-emerald-500/30"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setUploadForm((prev) => ({ ...prev, file }));
                }}
              />
              <label className="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Not (opsiyonel)</label>
              <textarea
                className="mt-1 min-h-[80px] rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                placeholder="Hazırlayan, hatırlatma vb."
                value={uploadForm.note}
                onChange={(event) => setUploadForm((prev) => ({ ...prev, note: event.target.value }))}
              />
              {uploadMessage ? (
                <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  {uploadMessage}
                </p>
              ) : null}
              <button
                type="submit"
                className="mt-5 inline-flex items-center justify-center rounded-lg border border-emerald-400/40 bg-gradient-to-r from-emerald-500/30 to-teal-500/30 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/70 hover:from-emerald-500/40 hover:to-teal-500/40"
              >
                Yüklemeyi Kaydet
              </button>
            </form>

            <form
              className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.95)]"
              onSubmit={handleDamageSubmit}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Hasar Bildirimi</h3>
                  <p className="text-xs text-slate-400">Her hasarı konum, tarih ve şiddetine göre kaydedin.</p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-400/50 bg-rose-500/20 text-rose-100">
                  🛠️
                </span>
              </div>
              <label className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Plaka</label>
              <input
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                placeholder="34 ABC 123"
                value={damageForm.plate}
                onChange={(event) => setDamageForm((prev) => ({ ...prev, plate: event.target.value }))}
              />
              <label className="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Başlık</label>
              <input
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                placeholder="Örn. Sağ kapı çizik"
                value={damageForm.title}
                onChange={(event) => setDamageForm((prev) => ({ ...prev, title: event.target.value }))}
              />
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Şiddet</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                    value={damageForm.severity}
                    onChange={(event) =>
                      setDamageForm((prev) => ({ ...prev, severity: event.target.value as DamageEntry["severity"] }))
                    }
                  >
                    {DAMAGE_SEVERITIES.map((severity) => (
                      <option key={severity} value={severity}>
                        {severity}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Tarih</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                    value={damageForm.occurredAt}
                    onChange={(event) => setDamageForm((prev) => ({ ...prev, occurredAt: event.target.value }))}
                  />
                </div>
              </div>
              <label className="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Açıklama</label>
              <textarea
                className="mt-1 min-h-[80px] rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                placeholder="Hasarın konumu, ek notlar..."
                value={damageForm.description}
                onChange={(event) => setDamageForm((prev) => ({ ...prev, description: event.target.value }))}
              />
              {damageMessage ? (
                <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{damageMessage}</p>
              ) : null}
              <button
                type="submit"
                className="mt-5 inline-flex items-center justify-center rounded-lg border border-rose-400/40 bg-gradient-to-r from-rose-500/30 to-amber-500/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:border-rose-300/70 hover:from-rose-500/40 hover:to-amber-500/40"
              >
                Hasarı Kaydet
              </button>
            </form>

            <form
              className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.95)]"
              onSubmit={handleExpenseSubmit}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Masraf Takibi</h3>
                  <p className="text-xs text-slate-400">Bakım, onarım ve diğer giderleri listeleyin.</p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-indigo-400/50 bg-indigo-500/20 text-indigo-100">
                  💳
                </span>
              </div>
              <label className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Plaka</label>
              <input
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                placeholder="34 ABC 123"
                value={expenseForm.plate}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, plate: event.target.value }))}
              />
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Kategori</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                    value={expenseForm.category}
                    onChange={(event) => setExpenseForm((prev) => ({ ...prev, category: event.target.value }))}
                  >
                    {EXPENSE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Tutar</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                    placeholder="Örn. 1500"
                    value={expenseForm.amount}
                    onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))}
                  />
                </div>
              </div>
              <label className="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Tarih</label>
              <input
                type="date"
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                value={expenseForm.createdAt}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, createdAt: event.target.value }))}
              />
              <label className="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-400">Açıklama</label>
              <textarea
                className="mt-1 min-h-[80px] rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                placeholder="İşlem detayları, servis bilgisi vb."
                value={expenseForm.description}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, description: event.target.value }))}
              />
              {expenseMessage ? (
                <p className="mt-3 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100">
                  {expenseMessage}
                </p>
              ) : null}
              <button
                type="submit"
                className="mt-5 inline-flex items-center justify-center rounded-lg border border-indigo-400/40 bg-gradient-to-r from-indigo-500/30 to-violet-500/30 px-4 py-2 text-sm font-medium text-indigo-100 transition hover:border-indigo-300/70 hover:from-indigo-500/40 hover:to-violet-500/40"
              >
                Masrafı Kaydet
              </button>
            </form>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Son Evrak Yüklemeleri</h3>
                <Badge className="border-emerald-300/40 bg-emerald-500/20 text-emerald-100">{uploadLog.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                En son eklenen 12 dosya listelenir. Sabit depolama için API entegrasyonu gerekir.
              </p>
              <div className="mt-4 space-y-3">
                {uploadLog.length === 0 ? (
                  <p className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-4 text-sm text-slate-300">
                    Henüz yükleme yapılmadı.
                  </p>
                ) : (
                  uploadLog.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-3">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>{new Date(entry.uploadedAt).toLocaleString("tr-TR")}</span>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-emerald-100">
                          {docTypeLabel(entry.docType)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm text-white">
                        <span className="font-semibold">{entry.plate}</span>
                        <span className="text-xs text-slate-300">{entry.fileName}</span>
                      </div>
                      {entry.note ? <p className="mt-1 text-xs text-slate-300">{entry.note}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Hasar Kayıtları</h3>
                <Badge className="border-rose-300/40 bg-rose-500/20 text-rose-100">{damageLog.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-400">Şiddete göre renklendirilmiş kronolojik kayıt.</p>
              <div className="mt-4 space-y-3">
                {damageLog.length === 0 ? (
                  <p className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-4 text-sm text-slate-300">
                    Henüz hasar bildirilmedi.
                  </p>
                ) : (
                  damageLog.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded-lg border px-3 py-3 ${
                        entry.severity === "Ağır"
                          ? "border-rose-500/50 bg-rose-500/10"
                          : entry.severity === "Orta"
                          ? "border-amber-400/40 bg-amber-500/10"
                          : "border-slate-700/70 bg-slate-900/80"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-200">
                        <span className="font-semibold text-white">{entry.plate}</span>
                        <span>{new Date(entry.occurredAt).toLocaleDateString("tr-TR")}</span>
                      </div>
                      <div className="mt-1 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-white">{entry.title}</p>
                          {entry.description ? <p className="text-xs text-slate-200">{entry.description}</p> : null}
                        </div>
                        <span className="rounded-full border border-white/20 bg-black/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-white">
                          {entry.severity}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Masraf Özeti</h3>
                <Badge className="border-indigo-300/40 bg-indigo-500/20 text-indigo-100">{expenseLog.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-400">Tutar, kategori ve tarih bazlı son hareketler.</p>
              <div className="mt-4">
                <div className="flex items-center justify-between rounded-lg border border-indigo-400/40 bg-indigo-500/10 px-3 py-3 text-sm font-semibold text-indigo-100">
                  <span>Toplam Tutar</span>
                  <span>{formatCurrency(totalExpense)}</span>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {expenseLog.length === 0 ? (
                  <p className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-4 text-sm text-slate-300">
                    Masraf kaydı bulunmuyor.
                  </p>
                ) : (
                  expenseLog.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-3">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>{new Date(entry.createdAt).toLocaleDateString("tr-TR")}</span>
                        <span className="rounded-full border border-indigo-300/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-indigo-100">
                          {entry.category}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm text-white">
                        <span className="font-semibold">{entry.plate}</span>
                        <span>{formatCurrency(entry.amount)}</span>
                      </div>
                      {entry.description ? <p className="mt-1 text-xs text-slate-300">{entry.description}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
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
