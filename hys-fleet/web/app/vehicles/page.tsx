"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Vehicle = {
  id: number;
  plate: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  responsible_email?: string | null;
  created_at?: string | null;
  document_count: number;
  next_valid_to?: string | null;
  days_left?: number | null;
};

type UpcomingDocument = {
  doc_id: number;
  plate: string;
  doc_type: string;
  valid_to: string;
  days_left: number | null;
};

type VehicleFormState = {
  plate: string;
  make: string;
  model: string;
  year: string;
  responsible_email: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const initialFormState: VehicleFormState = {
  plate: "",
  make: "",
  model: "",
  year: "",
  responsible_email: "",
};

const colorForDays = (days?: number | null) => {
  if (days === null || days === undefined) return "bg-slate-900 border-slate-700";
  if (days <= 7) return "bg-rose-600/80 border-rose-300/60";
  if (days <= 15) return "bg-amber-600/80 border-amber-300/60";
  if (days <= 30) return "bg-emerald-600/80 border-emerald-300/60";
  return "bg-slate-800/80 border-slate-600/60";
};

const formatDaysLabel = (days?: number | null) => {
  if (days === null || days === undefined) return "Planlı belge yok";
  if (days < 0) return `${Math.abs(days)} gün geçti`;
  if (days === 0) return "Bugün";
  return `${days} gün kaldı`;
};

export default function VehiclesPage() {
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

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const fetchVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/vehicles`);
      if (!res.ok) throw new Error("Araçlar yüklenemedi");
      const data = (await res.json()) as Vehicle[];
      setVehicles(data);
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
      const res = await fetch(`${API_BASE}/documents/upcoming?days=60`);
      if (!res.ok) throw new Error("Yaklaşan belgeler alınamadı");
      const data = (await res.json()) as UpcomingDocument[];
      setUpcomingDocs(data);
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
      responsible_email: formState.responsible_email.trim() || null,
    };
    if (payload.year !== null && Number.isNaN(payload.year)) {
      setFormError("Yıl bilgisi sayısal olmalı");
      return;
    }

    try {
      setFormSubmitting(true);
      const res = await fetch(`${API_BASE}/vehicles`, {
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
    setDeleteBusyId(vehicleId);
    try {
      const res = await fetch(`${API_BASE}/vehicles/${vehicleId}`, { method: "DELETE" });
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

  return (
    <section className="space-y-10">
      <header className="space-y-3">
        <h2 className="text-3xl font-semibold text-white">Araç Yönetimi</h2>
        <p className="text-sm text-slate-400">
          Araçları ekleyin, kaldırın ve yaklaşan belge bitişlerini takip edin.
        </p>
      </header>

      {toast ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-900/40 px-4 py-3 text-sm text-emerald-100">
          {toast}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <h3 className="text-lg font-semibold text-white">Yeni Araç Ekle</h3>
          <p className="mb-4 text-sm text-slate-400">
            Bildirim e-postası gönderebilmek için sorumlu kişiyi isteğe bağlı olarak tanımlayabilirsiniz.
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
              <label className="md:col-span-2 text-sm text-slate-300">
                Sorumlu E-posta
                <input
                  value={formState.responsible_email}
                  onChange={(e) => handleFormChange("responsible_email", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-slate-500 focus:outline-none"
                  placeholder="sorumlu@hys.local"
                  type="email"
                />
              </label>
            </div>
            {formError ? (
              <p className="rounded-md border border-rose-500/50 bg-rose-900/40 px-3 py-2 text-sm text-rose-100">
                {formError}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={formSubmitting}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {formSubmitting ? "Kaydediliyor..." : "Araç Ekle"}
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Yaklaşan Bitişler (60 gün)</h3>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
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
                  className={`rounded-lg border px-4 py-3 text-sm text-white shadow-sm ${colorForDays(doc.days_left)} `}
                >
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/70">
                    <span>{doc.plate}</span>
                    <span>{formatDaysLabel(doc.days_left)}</span>
                  </div>
                  <div className="mt-2 text-sm font-semibold capitalize">
                    {doc.doc_type.replace(/_/g, " ")}
                  </div>
                  <div className="mt-1 text-xs text-white/80">
                    Bitiş Tarihi: {new Date(doc.valid_to).toLocaleDateString("tr-TR")}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Araç Listesi</h3>
            <p className="text-sm text-slate-400">
              Arama kutusunu kullanarak plakaya, marka veya modele göre filtreleyin.
            </p>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Plaka, marka veya model ara..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-slate-500 focus:outline-none md:w-80"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">Plaka</th>
                <th className="px-4 py-3 text-left">Marka/Model</th>
                <th className="px-4 py-3 text-left">Belge Durumu</th>
                <th className="px-4 py-3 text-left">Sorumlu</th>
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
                filteredVehicles.map((vehicle) => (
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
                        className={`inline-flex min-w-[10rem] flex-col rounded-lg border px-3 py-2 text-xs ${colorForDays(vehicle.days_left)}`}
                      >
                        <span className="font-semibold">
                          {vehicle.next_valid_to
                            ? new Date(vehicle.next_valid_to).toLocaleDateString("tr-TR")
                            : "Belge bulunmuyor"}
                        </span>
                        <span className="text-white/80">
                          {formatDaysLabel(vehicle.days_left)}
                        </span>
                        <span className="text-white/60">Toplam belge: {vehicle.document_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm">
                      {vehicle.responsible_email ? (
                        <a
                          href={`mailto:${vehicle.responsible_email}`}
                          className="text-emerald-300 hover:underline"
                        >
                          {vehicle.responsible_email}
                        </a>
                      ) : (
                        <span className="text-slate-500">Tanımlı değil</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-300">
                      {vehicle.created_at
                        ? new Date(vehicle.created_at).toLocaleString("tr-TR")
                        : "-"}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        onClick={() => handleDeleteVehicle(vehicle.id)}
                        disabled={deleteBusyId === vehicle.id}
                        className="rounded-lg border border-rose-500/60 px-3 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deleteBusyId === vehicle.id ? "Siliniyor..." : "Sil"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
