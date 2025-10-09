"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../lib/api";

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

type TabId = "vehicles" | "vehicle-create" | "damages" | "expenses" | "documents";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "vehicles", label: "Araçlar" },
  { id: "vehicle-create", label: "Araç Ekle" },
  { id: "damages", label: "Hasarlar" },
  { id: "expenses", label: "Masraflar" },
  { id: "documents", label: "Belgeler" },
];

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

const isTabId = (value: string | null): value is TabId =>
  value !== null && tabs.some((tab) => tab.id === value);

export default function DashboardPage() {
  const [docs, setDocs] = useState<UpcomingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("vehicles");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const controller = new AbortController();

    const fetchDocs = async () => {
      try {
        const res = await fetch(apiUrl("/api/documents/upcoming?days=60"), {
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

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (isTabId(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
    if (!tabParam && activeTab !== "vehicles") {
      setActiveTab("vehicles");
    }
  }, [searchParams, activeTab]);

  const setTab = (nextTab: TabId) => {
    setActiveTab(nextTab);
    if (!router || !pathname) return;

    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === "vehicles") {
      params.delete("tab");
    } else {
      params.set("tab", nextTab);
    }

    const queryString = params.toString();
    const next = queryString ? `${pathname}?${queryString}` : pathname;
    router.replace(next, { scroll: false });
  };

  const groupedByPlate = useMemo(() => {
    const byPlate = new Map<
      string,
      {
        latestStatus: string;
        nextDocument?: UpcomingDocument;
        documents: UpcomingDocument[];
      }
    >();

    docs.forEach((doc) => {
      const plateInfo = byPlate.get(doc.plate) ?? {
        latestStatus: doc.status,
        nextDocument: undefined,
        documents: [],
      };

      plateInfo.documents.push(doc);
      // Belge listesini en yakın tarihe göre takip edelim
      const candidate = plateInfo.nextDocument;
      if (!candidate) {
        plateInfo.nextDocument = doc;
      } else {
        const candidateDate = new Date(candidate.valid_to).getTime();
        const docDate = new Date(doc.valid_to).getTime();
        if (docDate < candidateDate) {
          plateInfo.nextDocument = doc;
        }
      }

      // Daha kritik bir durum varsa onu sakla
      const statuses = ["critical", "expired", "warning", "ok"];
      const currentIndex = statuses.indexOf(plateInfo.latestStatus);
      const docIndex = statuses.indexOf(doc.status);
      if (docIndex !== -1 && (currentIndex === -1 || docIndex < currentIndex)) {
        plateInfo.latestStatus = doc.status;
      }

      byPlate.set(doc.plate, plateInfo);
    });

    return Array.from(byPlate.entries())
      .map(([plate, info]) => ({
        plate,
        latestStatus: info.latestStatus,
        nextDocument: info.nextDocument,
        documents: info.documents,
      }))
      .sort((a, b) => a.plate.localeCompare(b.plate, "tr"));
  }, [docs]);

  const renderTabContent = () => {
    if (activeTab === "vehicles") {
      return (
        <section className="space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Filodaki Araçlar</h2>
              <p className="text-sm text-slate-400">
                Önümüzdeki 60 gün içinde belge yenilemesi olan araçların durumu
              </p>
            </div>
            <span className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-300">
              {loading ? "Yükleniyor..." : `${groupedByPlate.length} araç`}
            </span>
          </header>

          {groupedByPlate.length === 0 && !loading ? (
            <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">
              Yakın tarihte yenilecek belge bilgisi bulunan araç yok.
            </p>
          ) : null}

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {groupedByPlate.map((vehicle) => (
              <article
                key={vehicle.plate}
                className={`rounded-xl border shadow-lg shadow-slate-900/40 transition hover:-translate-y-1 hover:shadow-slate-800/60 ${statusClass(vehicle.latestStatus)}`}
              >
                <div className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm uppercase tracking-wide text-white/70">Plaka</span>
                    <span className="text-lg font-semibold text-white">{vehicle.plate}</span>
                  </div>

                  {vehicle.nextDocument ? (
                    <>
                      <div>
                        <span className="text-xs uppercase tracking-wide text-white/70">Sıradaki Belge</span>
                        <h3 className="text-lg font-semibold capitalize text-white">
                          {vehicle.nextDocument.doc_type.replace(/_/g, " ")}
                        </h3>
                      </div>
                      <div className="flex items-center justify-between text-sm text-white/80">
                        <span>Bitiş Tarihi</span>
                        <span>{new Date(vehicle.nextDocument.valid_to).toLocaleDateString("tr-TR")}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm font-medium text-white">
                        <span>Kalan Gün</span>
                        <span>{vehicle.nextDocument.days_left ?? "-"}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-white/70">Takvimde yaklaşan belge bulunmuyor.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      );
    }

    if (activeTab === "vehicle-create") {
      return (
        <section className="space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Araç Ekle</h2>
              <p className="text-sm text-slate-400">Yeni araç kayıtlarını hızlıca oluşturun</p>
            </div>
            <Link
              href="/vehicles"
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              Yönetim Panelini Aç
            </Link>
          </header>
          <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-sm text-slate-300">
            Yeni araç eklemek, belge ve bakım kayıtlarını yönetmek için&nbsp;
            <span className="font-semibold">Araç Yönetimi</span> panelini kullanabilirsiniz. Panel, araç bilgilerini,
            belge ekleme ve bakım kayıtlarını tek ekranda sunar.
          </p>
        </section>
      );
    }

    if (activeTab === "damages") {
      return (
        <section className="space-y-4">
          <header>
            <h2 className="text-xl font-semibold">Hasar Kayıtları</h2>
            <p className="text-sm text-slate-400">Araçlarda oluşan hasarları kaydedip takip edin</p>
          </header>
          <p className="rounded-lg border border-amber-500/40 bg-amber-900/30 p-4 text-sm text-amber-100">
            Hasar kayıt modülü henüz tanımlanmadı. Bu sekmeye form veya liste eklenecekse, istenen alanları belirtin.
          </p>
        </section>
      );
    }

    if (activeTab === "expenses") {
      return (
        <section className="space-y-4">
          <header>
            <h2 className="text-xl font-semibold">Masraf Takibi</h2>
            <p className="text-sm text-slate-400">Araç bazlı masrafları kategorilere göre raporlayın</p>
          </header>
          <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-sm text-slate-300">
            Masraf kayıtları için veri kaynağı belirlenmedi. Eklemek istediğiniz alanları paylaşırsanız arayüzü
            genişletebilirim.
          </p>
        </section>
      );
    }

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
          <p className="rounded-lg border border-rose-500/40 bg-rose-900/40 p-4 text-sm text-rose-100">{error}</p>
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
                    <h3 className="text-xl font-semibold capitalize text-white">
                      {doc.doc_type.replace(/_/g, " ")}
                    </h3>
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
                  {doc.note ? <p className="text-xs text-white/70">Not: {doc.note}</p> : null}
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
  };

  return (
    <section className="space-y-8">
      <nav className="flex flex-wrap gap-2 rounded-full border border-slate-800 bg-slate-900/70 p-1 text-sm">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`rounded-full px-4 py-2 transition ${
                isActive ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/40" : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {renderTabContent()}
    </section>
  );
}
