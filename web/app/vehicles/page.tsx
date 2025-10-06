"use client";
import { apiUrl } from "../../lib/api";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";

const DOCUMENT_TYPES = [
  { value: "inspection", label: "Muayene" },
  { value: "k_document", label: "K Belgesi" },
  { value: "traffic_insurance", label: "Trafik Sigortası" },
  { value: "kasko", label: "Kasko" },
  // Yeni tipler (belge yapısını bozmadan bakım kaydı için)
  { value: "service_oil", label: "Yağ Bakımı" },
  { value: "service_general", label: "Genel Bakım" },
];

const MAINTENANCE_TYPES = [
  { value: "service_oil", label: "Yağ Bakımı" },
  { value: "service_general", label: "Genel Bakım" },
] as const;

const PASSWORD_STORAGE_KEY = "hys-fleet-admin-password";

const DOC_TYPE_LABELS: Record<string, string> = {
  inspection: "Muayene",
  muayene: "Muayene",
  k_document: "K Belgesi",
  k: "K Belgesi",
  k_belgesi: "K Belgesi",
  traffic_insurance: "Trafik Sigortası",
  insurance: "Trafik Sigortası",
  trafik_sigortası: "Trafik Sigortası",
  kasko: "Kasko",
  service_oil: "Yağ Bakımı",
  service_general: "Genel Bakım",
};

const docTypeLabel = (value: string) => {
  const safe = value ?? "";
  const key = safe.toLowerCase().replace(/\s+/g, "_");
  return DOC_TYPE_LABELS[key] ?? safe.replace(/_/g, " ");
};

// note içinden km=123456 değerini ayıklar
const parseKmFromNote = (note?: string | null): number | null => {
  if (!note) return null;
  const m = note.match(/km\s*=\s*(\d{1,9})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

type Vehicle = {
  id: number;
  plate: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  created_at?: string | null;
  document_count: number;
  next_valid_to?: string | null;
  days_left?: number | null;
  next_status?: string | null;
  documents: Array<{
    id: number;
    doc_type: string;
    valid_from: string | null;
    valid_to: string | null;
    note?: string | null;
    days_left: number | null;
    status: string;
  }>;
};

type UpcomingDocument = {
  doc_id: number;
  plate: string;
  doc_type: string;
  valid_from: string | null;
  valid_to: string;
  note?: string | null;
  days_left: number | null;
  status: string;
};

type VehicleFormState = {
  plate: string;
  make: string;
  model: string;
  year: string;
};

const initialFormState: VehicleFormState = {
  plate: "",
  make: "",
  model: "",
  year: "",
};

const statusClass = (status: string | null | undefined, fallback = "bg-slate-900 border-slate-700") => {
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
      return fallback;
  }
};

const formatDaysLabel = (days?: number | null) => {
  if (days === null || days === undefined) return "Planlı belge yok";
  if (days < 0) return `${Math.abs(days)} gün geçti`;
  if (days === 0) return "Bugün";
  return `${days} gün kaldı`;
};

export default function VehiclesPage() {
  const { mutate } = useSWRConfig();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [upcomingDocs, setUpcomingDocs] = useState<UpcomingDocument[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formState, setFormState] = useState<VehicleFormState>(initialFormState);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);

  // Belge formu (mevcut)
  const [docForm, setDocForm] = useState({
    doc_type: DOCUMENT_TYPES[0].value,
    valid_from: "",
    valid_to: "",
    note: "",
  });
  const [docSubmitting, setDocSubmitting] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docDeleteBusyId, setDocDeleteBusyId] = useState<number | null>(null);

  // Yeni: Bakım formu (KM ile)
  const [mntForm, setMntForm] = useState<{
    mnt_type: (typeof MAINTENANCE_TYPES)[number]["value"];
    date: string; // valid_from/valid_to için aynı gün
    km: string;   // string input, sayıya çevireceğiz
    note: string;
  }>({
    mnt_type: "service_oil",
    date: "",
    km: "",
    note: "",
  });
  const [mntSubmitting, setMntSubmitting] = useState(false);
  const [mntError, setMntError] = useState<string | null>(null);

  const isAdmin = adminPassword.trim().length > 0;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(PASSWORD_STORAGE_KEY);
    if (stored && stored.trim()) {
      setAdminPassword(stored.trim());
    } else {
      const answer = window.prompt(
        "Yönetici işlemleri için şifre girin (salt okunur görüntüleme için boş bırakabilirsiniz)",
        ""
      );
      if (answer && answer.trim()) {
        setAdminPassword(answer.trim());
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (adminPassword.trim()) {
      window.localStorage.setItem(PASSWORD_STORAGE_KEY, adminPassword.trim());
    } else {
      window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
    }
  }, [adminPassword]);

  const handleAdminPrompt = () => {
    if (typeof window === "undefined") return;
    const answer = window.prompt(
      "Yönetici şifresini girin (salt okunur için boş bırakın)",
      adminPassword
    );
    if (answer === null) return;
    setAdminPassword(answer.trim());
    setFormError(null);
    setDocError(null);
    setMntError(null);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const fetchVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    try {
      const res = await fetch(apiUrl("/api/vehicles"));
      if (!res.ok) throw new Error("Araçlar yüklenemedi");
      const data = (await res.json()) as Vehicle[];
      setVehicles(
        data.map((vehicle) => ({
          ...vehicle,
          days_left: vehicle.days_left ?? null,
          next_status: vehicle.next_status ?? null,
          documents: (vehicle.documents ?? []).map((doc) => ({
            ...doc,
            id: doc.id,
            days_left: doc.days_left ?? null,
          })),
        }))
      );
    } catch (error) {
      console.error(error);
      setToast("Araç listesi alınırken hata oluştu");
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  const fetchUpcoming = useCallback(async () => {
    setUpcomingLoading(true);
    try {
      const res = await fetch(apiUrl("/api/documents/upcoming?days=60"));
      if (!res.ok) throw new Error("Yaklaşan belgeler alınamadı");
      const data = (await res.json()) as UpcomingDocument[];
      setUpcomingDocs(
        data.map((doc) => ({
          ...doc,
          days_left: doc.days_left ?? null,
        }))
      );
    } catch (error) {
      console.error(error);
      setToast("Yaklaşan belgeler alınamadı");
    } finally {
      setUpcomingLoading(false);
    }
  }, []);

  const refreshData = useCallback(async () => {
    await Promise.all([fetchVehicles(), fetchUpcoming()]);
  }, [fetchVehicles, fetchUpcoming]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (vehicles.length === 0) {
      setSelectedVehicleId(null);
      return;
    }
    if (!selectedVehicleId || !vehicles.some((v) => v.id === selectedVehicleId)) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [vehicles, selectedVehicleId]);

  const filteredVehicles = useMemo(() => {
    const term = search.toLowerCase();
    return vehicles.filter((v) =>
      v.plate.toLowerCase().includes(term) ||
      (v.model ?? "").toLowerCase().includes(term) ||
      (v.make ?? "").toLowerCase().includes(term)
    );
  }, [vehicles, search]);

  const handleFormChange = (field: keyof VehicleFormState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleDocFormChange = (field: keyof typeof docForm, value: string) => {
    setDocForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleMntFormChange = (field: keyof typeof mntForm, value: string) => {
    setMntForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddVehicle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!formState.plate.trim()) {
      setFormError("Plaka zorunlu");
      return;
    }
    const payload = {
      plate: formState.plate.trim().toUpperCase(),
      make: formState.make.trim() || null,
      model: formState.model.trim() || null,
      year: formState.year ? Number(formState.year) : null,
      admin_password: adminPassword,
    };
    if (!adminPassword.trim()) {
      setFormError("Şifre gerekli");
      return;
    }
    if (payload.year !== null && Number.isNaN(payload.year)) {
      setFormError("Yıl bilgisi sayısal olmalı");
      return;
    }

    try {
      setFormSubmitting(true);
      const res = await fetch(apiUrl("/api/vehicles"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(errorPayload.detail ?? "Araç eklenemedi");
      }
      setFormState(initialFormState);
      setToast("Araç başarıyla eklendi");
      await mutate(apiUrl("/api/vehicles"));
      await refreshData();
    } catch (error) {
      console.error(error);
      setFormError((error as Error).message);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteVehicle = async (vehicleId: number) => {
    if (!confirm("Aracı silmek istediğinize emin misiniz?")) return;
    if (!adminPassword.trim()) {
      setToast("Silme işlemi için şifre girin");
      return;
    }
    setDeleteBusyId(vehicleId);
    try {
      const res = await fetch(
        apiUrl(`/api/vehicles/${vehicleId}?admin_password=${encodeURIComponent(adminPassword)}`),
        { method: "DELETE" }
      );
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(errorPayload.detail ?? "Araç silinemedi");
      }
      setToast("Araç silindi");
      await refreshData();
    } catch (error) {
      console.error(error);
      setToast((error as Error).message);
    } finally {
      setDeleteBusyId(null);
    }
  };

  const handleAddDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDocError(null);
    if (!selectedVehicleId) {
      setDocError("Önce araç seçin");
      return;
    }
    if (!adminPassword.trim()) {
      setDocError("Şifre gerekli");
      return;
    }
    if (!docForm.valid_to) {
      setDocError("Bitiş tarihi zorunlu");
      return;
    }

    const payload = {
      vehicle_id: selectedVehicleId,
      doc_type: docForm.doc_type.trim() || DOCUMENT_TYPES[0].value,
      valid_from: docForm.valid_from || null,
      valid_to: docForm.valid_to,
      note: docForm.note.trim() || null,
      admin_password: adminPassword,
    };

    try {
      setDocSubmitting(true);
      const res = await fetch(apiUrl("/api/documents"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(errorPayload.detail ?? "Belge eklenemedi");
      }
      setDocForm((prev) => ({ ...prev, valid_from: "", valid_to: "", note: "" }));
      setToast("Belge kaydı oluşturuldu");
      await mutate(apiUrl("/api/vehicles"));
      await refreshData();
    } catch (error) {
      console.error(error);
      setDocError((error as Error).message);
    } finally {
      setDocSubmitting(false);
    }
  };

  // Yeni: Bakım kaydı (KM ile) — documents API’sini kullanır
  const handleAddMaintenance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMntError(null);
    if (!selectedVehicleId) {
      setMntError("Önce araç seçin");
      return;
    }
    if (!adminPassword.trim()) {
      setMntError("Şifre gerekli");
      return;
    }
    if (!mntForm.date) {
      setMntError("Bakım tarihi zorunlu");
      return;
    }
    const kmNum = mntForm.km ? Number(mntForm.km) : NaN;
    if (mntForm.km && (Number.isNaN(kmNum) || kmNum < 0)) {
      setMntError("KM değeri geçersiz");
      return;
    }

    const noteParts = [];
    if (mntForm.km) noteParts.push(`km=${kmNum}`);
    if (mntForm.note.trim()) noteParts.push(mntForm.note.trim());
    const noteCombined = noteParts.join("; ");

    const payload = {
      vehicle_id: selectedVehicleId,
      doc_type: mntForm.mnt_type,        // service_oil | service_general
      valid_from: mntForm.date,          // bakım tarihi
      valid_to: mntForm.date,            // aynı gün
      note: noteCombined || null,
      admin_password: adminPassword,
    };

    try {
      setMntSubmitting(true);
      const res = await fetch(apiUrl("/api/documents"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(errorPayload.detail ?? "Bakım kaydı eklenemedi");
      }
      setMntForm({ mnt_type: "service_oil", date: "", km: "", note: "" });
      setToast("Bakım kaydı oluşturuldu");
      await mutate(apiUrl("/api/vehicles"));
      await refreshData();
    } catch (error) {
      console.error(error);
      setMntError((error as Error).message);
    } finally {
      setMntSubmitting(false);
    }
  };

  const handleDeleteDocument = async (documentId: number) => {
    if (!adminPassword.trim()) {
      setToast("Belge silmek için şifre girin");
      return;
    }
    if (!confirm("Belgeyi silmek istediğinize emin misiniz?")) return;
    setDocDeleteBusyId(documentId);
    try {
      const res = await fetch(
        apiUrl(`/api/documents/${documentId}?admin_password=${encodeURIComponent(adminPassword)}`),
        { method: "DELETE" }
      );
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(errorPayload.detail ?? "Belge silinemedi");
      }
      setToast("Belge silindi");
      await refreshData();
    } catch (error) {
      console.error(error);
      setToast((error as Error).message);
    } finally {
      setDocDeleteBusyId(null);
    }
  };

  // Araç için son KM: service_* belgelerindeki en güncel km’yi bul
  const getLastKmForVehicle = (v: Vehicle): number | null => {
    const serviceDocs = (v.documents ?? []).filter(d =>
      d.doc_type === "service_oil" || d.doc_type === "service_general"
    );
    if (serviceDocs.length === 0) return null;

    // Tarihe göre en yeni bakım belgesini bul
    const withDates = serviceDocs.map(d => ({
      d,
      date: d.valid_from ?? d.valid_to ?? null,
    })).filter(x => !!x.date) as Array<{ d: Vehicle["documents"][number]; date: string }>;

    // Hem en büyük tarih hem de nottan km parse’ı yapıp en yüksek km’yi tercih et
    let bestKm: number | null = null;
    for (const s of serviceDocs) {
      const km = parseKmFromNote(s.note);
      if (km != null) {
        if (bestKm == null || km > bestKm) bestKm = km;
      }
    }
    if (bestKm != null) return bestKm;

    // KM bulunamadıysa null
    return null;
  };

  return (
    <section className="space-y-10 max-w-7xl mx-auto px-3 sm:px-4 md:px-6">
      <header className="space-y-3">
        <h2 className="text-2xl sm:text-3xl font-semibold text-white">Araç Yönetimi</h2>
        <p className="text-sm text-slate-400">
          Araçları ekleyin, kaldırın ve yaklaşan belge bitişlerini takip edin. Bakım ve KM girişleri için aşağıdaki formları kullanın.
        </p>
      </header>

      {toast ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-900/40 px-4 py-3 text-sm text-emerald-100">
          {toast}
        </div>
      ) : null}

      <div className="grid gap-6 sm:gap-7 lg:grid-cols-[2fr_3fr]">
        {/* Yeni Araç Ekle */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-white">Yeni Araç Ekle</h3>
          <p className="mb-4 text-sm text-slate-400">
            Silme veya belge işlemleri için sağ üstteki şifre alanını kullanın.
          </p>
          <form className="space-y-4" onSubmit={handleAddVehicle}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-300">
                Plaka*
                <input
                  value={formState.plate}
                  onChange={(e) => handleFormChange("plate", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                  placeholder="34ABC123"
                  required
                />
              </label>
              <label className="text-sm text-slate-300">
                Marka
                <input
                  value={formState.make}
                  onChange={(e) => handleFormChange("make", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                  placeholder="Volvo"
                />
              </label>
              <label className="text-sm text-slate-300">
                Model
                <input
                  value={formState.model}
                  onChange={(e) => handleFormChange("model", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                  placeholder="FH16"
                />
              </label>
              <label className="text-sm text-slate-300">
                Yıl
                <input
                  value={formState.year}
                  onChange={(e) => handleFormChange("year", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                  placeholder="2024"
                  inputMode="numeric"
                />
              </label>
            </div>
            {formError ? (
              <p className="rounded-md border border-rose-500/50 bg-rose-900/40 px-3 py-2 text-sm text-rose-100">
                {formError}
              </p>
            ) : null}
            {!isAdmin ? (
              <p className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400">
                Şifre girilmediği için bu form pasif durumdadır.
              </p>
            ) : null}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={formSubmitting || !isAdmin}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {formSubmitting ? "Kaydediliyor..." : "Araç Ekle"}
              </button>
            </div>
          </form>
        </div>

        {/* Yaklaşan Bitişler + Belge Oluştur */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Yaklaşan Bitişler (60 gün)</h3>
            <span className="rounded-full bg-slate-800 px-2.5 sm:px-3 py-0.5 sm:py-1 text-xs text-slate-300">
              {upcomingLoading ? "Yükleniyor" : `${upcomingDocs.length} belge`}
            </span>
          </div>
          {upcomingLoading ? (
            <p className="text-sm text-slate-400">Yaklaşan belgeler yükleniyor...</p>
          ) : upcomingDocs.length === 0 ? (
            <p className="text-sm text-slate-400">Önümüzdeki 60 günde süresi dolacak belge bulunmuyor.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {upcomingDocs.map((doc) => (
                <article
                  key={doc.doc_id}
                  className={`rounded-lg border px-4 py-3 text-sm text-white shadow-sm ${statusClass(doc.status, "bg-slate-900 border-slate-700")}`}
                >
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/70">
                    <span>{doc.plate}</span>
                    <span>{formatDaysLabel(doc.days_left)}</span>
                  </div>
                  <div className="mt-2 text-sm font-semibold capitalize">
                    {docTypeLabel(doc.doc_type)}
                  </div>
                  <div className="mt-1 text-xs text-white/80">
                    Bitiş Tarihi: {new Date(doc.valid_to).toLocaleDateString("tr-TR")}
                  </div>
                  {doc.valid_from ? (
                    <div className="text-xs text-white/60">
                      Başlangıç: {new Date(doc.valid_from).toLocaleDateString("tr-TR")}
                    </div>
                  ) : null}
                  {doc.note ? (
                    <div className="text-xs text-white/60">Not: {doc.note}</div>
                  ) : null}
                </article>
              ))}
            </div>
          )}

          <div className="mt-8 border-t border-slate-800 pt-5">
            <h3 className="text-lg font-semibold text-white">Belge Oluştur</h3>
            <p className="mb-4 text-sm text-slate-400">
              Muayene, sigorta gibi belgelerin başlangıç/bitiş tarihlerini girerek takibe ekleyin.
            </p>
            <form className="space-y-4" onSubmit={handleAddDocument}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Araç*
                  <select
                    value={selectedVehicleId ?? ""}
                    onChange={(e) => setSelectedVehicleId(Number(e.target.value) || null)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                    required
                  >
                    <option value="" disabled>
                      Araç seçin
                    </option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.plate} {vehicle.make ? `- ${vehicle.make}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Belge Türü*
                  <select
                    value={docForm.doc_type}
                    onChange={(e) => handleDocFormChange("doc_type", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                  >
                    {DOCUMENT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Geçerlilik Başlangıcı
                  <input
                    type="date"
                    value={docForm.valid_from}
                    onChange={(e) => handleDocFormChange("valid_from", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                  />
                </label>
                <label className="text-sm text-slate-300">
                  Geçerlilik Bitişi*
                  <input
                    type="date"
                    value={docForm.valid_to}
                    onChange={(e) => handleDocFormChange("valid_to", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                    required
                  />
                </label>
                <label className="md:col-span-2 text-sm text-slate-300">
                  Not
                  <textarea
                    value={docForm.note}
                    onChange={(e) => handleDocFormChange("note", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                    rows={3}
                    placeholder="Örn. Muayene randevusu alınacak"
                  />
                </label>
              </div>
              {docError ? (
                <p className="rounded-md border border-rose-500/50 bg-rose-900/40 px-3 py-2 text-sm text-rose-100">
                  {docError}
                </p>
              ) : null}
              {!isAdmin ? (
                <p className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400">
                  Belge eklemek için önce şifre girin.
                </p>
              ) : null}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={docSubmitting || !isAdmin}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {docSubmitting ? "Kaydediliyor..." : "Belgeyi Kaydet"}
                </button>
              </div>
            </form>
          </div>

          {/* Yeni: Bakım Kaydı (KM ile) */}
          <div className="mt-8 border-t border-slate-800 pt-5">
            <h3 className="text-lg font-semibold text-white">Bakım Kaydı Oluştur (KM ile)</h3>
            <p className="mb-4 text-sm text-slate-400">
              Yağ bakımı / genel bakım için tarih ve KM girin. KM bilgisi not içinde saklanır (ör. <code>km=185000</code>).
            </p>
            <form className="space-y-4" onSubmit={handleAddMaintenance}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Araç*
                  <select
                    value={selectedVehicleId ?? ""}
                    onChange={(e) => setSelectedVehicleId(Number(e.target.value) || null)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                    required
                  >
                    <option value="" disabled>
                      Araç seçin
                    </option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.plate} {vehicle.make ? `- ${vehicle.make}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Bakım Türü*
                  <select
                    value={mntForm.mnt_type}
                    onChange={(e) => handleMntFormChange("mnt_type", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                    required
                  >
                    {MAINTENANCE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Bakım Tarihi*
                  <input
                    type="date"
                    value={mntForm.date}
                    onChange={(e) => handleMntFormChange("date", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                    required
                  />
                </label>
                <label className="text-sm text-slate-300">
                  KM
                  <input
                    value={mntForm.km}
                    onChange={(e) => handleMntFormChange("km", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                    placeholder="Örn. 185000"
                    inputMode="numeric"
                  />
                </label>
                <label className="md:col-span-2 text-sm text-slate-300">
                  Not
                  <textarea
                    value={mntForm.note}
                    onChange={(e) => handleMntFormChange("note", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                    rows={3}
                    placeholder="Örn. Filtreler değişti"
                  />
                </label>
              </div>
              {mntError ? (
                <p className="rounded-md border border-rose-500/50 bg-rose-900/40 px-3 py-2 text-sm text-rose-100">
                  {mntError}
                </p>
              ) : null}
              {!isAdmin ? (
                <p className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400">
                  Bakım eklemek için önce şifre girin.
                </p>
              ) : null}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={mntSubmitting || !isAdmin}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {mntSubmitting ? "Kaydediliyor..." : "Bakımı Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Araç Listesi */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Araç Listesi</h3>
            <p className="text-sm text-slate-400">
              Arama kutusunu kullanarak plakaya, marka veya modele göre filtreleyin. Şifre girilmezse sayfa salt okunur modda kalır.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  isAdmin
                    ? "bg-emerald-600/20 text-emerald-300"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {isAdmin ? "Yönetici modu aktif" : "Salt okunur mod"}
              </span>
              <button
                type="button"
                onClick={handleAdminPrompt}
                className="rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-200 transition hover:border-slate-400 hover:text-white"
              >
                {isAdmin ? "Şifreyi değiştir" : "Şifre gir"}
              </button>
            </div>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Plaka, marka veya model ara..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-slate-500 focus:outline-none md:w-72"
          />
        </div>

        {/* Mobile list view (sm:hidden) */}
        <div className="sm:hidden space-y-3">
          {vehiclesLoading ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-slate-400">
              Araçlar yükleniyor...
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-slate-400">
              Sonuç bulunamadı.
            </div>
          ) : (
            filteredVehicles.map((vehicle) => {
              const lastKm = getLastKmForVehicle(vehicle);
              return (
                <article key={vehicle.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-white break-words">{vehicle.plate}</div>
                      <div className="text-xs text-slate-400 break-words">
                        {((vehicle.make ?? "").trim() || (vehicle.model ?? "").trim())
                          ? `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()
                          : "-"}
                        {vehicle.year ? ` • ${vehicle.year}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteVehicle(vehicle.id)}
                      disabled={deleteBusyId === vehicle.id || !isAdmin}
                      className="shrink-0 rounded-md border border-rose-500/60 px-2.5 py-1 text-[11px] font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deleteBusyId === vehicle.id ? "Siliniyor..." : "Sil"}
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                    <div className={`rounded-md border px-2 py-1 ${statusClass(
                      vehicle.next_status ?? (vehicle.days_left != null && vehicle.days_left >= 0
                        ? vehicle.days_left <= 7
                          ? "critical"
                          : vehicle.days_left <= 30
                            ? "warning"
                            : "ok"
                        : vehicle.days_left != null && vehicle.days_left < 0
                          ? "expired"
                          : "unknown"),
                      "bg-slate-900 border-slate-700"
                    )}`}>
                      <div className="font-semibold">
                        {vehicle.next_valid_to
                          ? new Date(vehicle.next_valid_to).toLocaleDateString("tr-TR")
                          : "Belge yok"}
                      </div>
                      <div className="text-white/80">{formatDaysLabel(vehicle.days_left)}</div>
                    </div>
                    <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1">
                      <div className="text-white/80">Son KM</div>
                      <div className="font-semibold text-white">{lastKm != null ? `${lastKm.toLocaleString("tr-TR")} km` : "-"}</div>
                    </div>
                  </div>

                  {vehicle.documents.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {vehicle.documents.slice(0, 3).map((doc) => (
                        <div
                          key={`${vehicle.id}-${doc.id}`}
                          className={`rounded-lg border px-3 py-2 ${statusClass(doc.status, "bg-slate-900/80 border-slate-700")}`}
                        >
                          <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-white/70">
                            <span className="truncate">{docTypeLabel(doc.doc_type)}</span>
                            <span className="shrink-0">{formatDaysLabel(doc.days_left)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/80">
                            <span>Bitiş: {doc.valid_to ? new Date(doc.valid_to).toLocaleDateString("tr-TR") : "-"}</span>
                            {doc.valid_from ? (
                              <span>Başlangıç: {new Date(doc.valid_from).toLocaleDateString("tr-TR")}</span>
                            ) : null}
                            {doc.note ? <span className="break-words">Not: {doc.note}</span> : null}
                          </div>
                        </div>
                      ))}
                      {vehicle.documents.length > 3 ? (
                        <div className="text-[11px] text-slate-400">
                          +{vehicle.documents.length - 3} belge daha
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">Plaka</th>
                <th className="px-4 py-3 text-left">Marka/Model</th>
                <th className="px-4 py-3 text-left">Belge Durumu</th>
                <th className="px-4 py-3 text-left">Son KM</th>
                <th className="px-4 py-3 text-left">Eklenme</th>
                <th className="px-4 py-3 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {vehiclesLoading ? (
                <tr>
                  <td className="px-4 py-4 text-center text-slate-400" colSpan={6}>
                    Araçlar yükleniyor...
                  </td>
                </tr>
              ) : filteredVehicles.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-center text-slate-400" colSpan={6}>
                    Sonuç bulunamadı.
                  </td>
                </tr>
              ) : (
                filteredVehicles.map((vehicle) => {
                  const lastKm = getLastKmForVehicle(vehicle);
                  return (
                    <tr key={vehicle.id} className="hover:bg-slate-800/60">
                      <td className="px-4 py-4 font-semibold text-white">{vehicle.plate}</td>
                      <td className="px-4 py-4">
                        <div className="text-white">
                          {(vehicle.make ?? "").trim() || (vehicle.model ?? "").trim()
                            ? `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()
                            : "-"}
                        </div>
                        {vehicle.year ? (
                          <div className="text-xs text-slate-500">{vehicle.year}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-4">
                        <div
                          className={`inline-flex min-w-[10rem] flex-col rounded-lg border px-3 py-2 text-xs ${statusClass(
                            vehicle.next_status ?? (vehicle.days_left != null && vehicle.days_left >= 0
                              ? vehicle.days_left <= 7
                                ? "critical"
                                : vehicle.days_left <= 30
                                  ? "warning"
                                  : "ok"
                              : vehicle.days_left != null && vehicle.days_left < 0
                                ? "expired"
                                : "unknown"),
                            "bg-slate-900 border-slate-700"
                          )}`}
                        >
                          <span className="font-semibold">
                            {vehicle.next_valid_to
                              ? new Date(vehicle.next_valid_to).toLocaleDateString("tr-TR")
                              : "Belge bulunmuyor"}
                          </span>
                          <span className="text-white/80">{formatDaysLabel(vehicle.days_left)}</span>
                          <span className="text-white/60">Toplam belge: {vehicle.document_count}</span>
                        </div>
                        {vehicle.documents.length > 0 ? (
                          <div className="mt-3 space-y-2 text-xs text-white/80">
                            {vehicle.documents.map((doc) => (
                              <div
                                key={`${vehicle.id}-${doc.id}`}
                                className={`rounded-lg border px-3 py-2 ${statusClass(doc.status, "bg-slate-900/80 border-slate-700")}`}
                              >
                                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-white/70">
                                  <span>{docTypeLabel(doc.doc_type)}</span>
                                  <div className="flex items-center gap-2">
                                    <span>{formatDaysLabel(doc.days_left)}</span>
                                    <button
                                      onClick={() => handleDeleteDocument(doc.id)}
                                      disabled={docDeleteBusyId === doc.id || !isAdmin}
                                      className="rounded-md border border-rose-400/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rose-100 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {docDeleteBusyId === doc.id ? "Siliniyor" : "Sil"}
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-1 flex flex-col gap-1 text-[11px] text-white/80">
                                  <span>
                                    Bitiş: {doc.valid_to ? new Date(doc.valid_to).toLocaleDateString("tr-TR") : "-"}
                                  </span>
                                  {doc.valid_from ? (
                                    <span>Başlangıç: {new Date(doc.valid_from).toLocaleDateString("tr-TR")}</span>
                                  ) : null}
                                  {doc.note ? <span>Not: {doc.note}</span> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300">
                        {lastKm != null ? `${lastKm.toLocaleString("tr-TR")} km` : "-"}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300">
                        {vehicle.created_at
                          ? new Date(vehicle.created_at).toLocaleString("tr-TR")
                          : "-"}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          onClick={() => handleDeleteVehicle(vehicle.id)}
                          disabled={deleteBusyId === vehicle.id || !isAdmin}
                          className="rounded-lg border border-rose-500/60 px-3 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deleteBusyId === vehicle.id ? "Siliniyor..." : "Sil"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}