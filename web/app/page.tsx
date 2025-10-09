"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { apiUrl } from "../lib/api";

type UpcomingDocument = {
  id: number;
  doc_id: number;
  plate: string;
  doc_type: string;
  doc_label?: string;
  valid_from: string | null;
  valid_to: string;
  note?: string | null;
  days_left: number | null;
  status: string;
  responsible_email?: string | null;
  responsible_person?: string | null;
};

type VehicleDocument = {
  id: number;
  doc_type: string;
  doc_label?: string;
  valid_from: string | null;
  valid_to: string | null;
  note?: string | null;
  days_left: number | null;
  status: string;
};

type Vehicle = {
  id: number;
  plate: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  responsible_email?: string | null;
  responsible_person?: string | null;
  created_at?: string | null;
  document_count: number;
  next_valid_to?: string | null;
  days_left?: number | null;
  next_status?: string | null;
  documents?: VehicleDocument[];
};

type TabId = "vehicles" | "vehicle-create" | "damages" | "expenses" | "documents";

type VehicleFormState = {
  plate: string;
  make: string;
  model: string;
  year: string;
  responsible_person: string;
};

type DocumentFormState = {
  vehicleId: string;
  doc_type: string;
  valid_from: string;
  valid_to: string;
  note: string;
};

type DamageSeverity = "Hafif" | "Orta" | "Ağır";

type DamageAttachment = {
  id: number;
  name: string;
  mimeType: string | null;
  preview: string;
  size: number | null;
};

type DamageEntry = {
  id: number;
  plate: string;
  title: string;
  description: string;
  severity: DamageSeverity;
  occurredAt: string;
  createdAt: string;
  attachments: DamageAttachment[];
};

type ExpenseAttachment = {
  id: number;
  name: string;
  mimeType: string | null;
  preview: string;
  size: number | null;
};

type ExpenseEntry = {
  id: number;
  plate: string;
  category: string;
  amount: number;
  description: string;
  createdAt: string;
  expenseDate: string;
  attachments: ExpenseAttachment[];
};

type DamageFormState = {
  plate: string;
  title: string;
  description: string;
  severity: DamageSeverity;
  occurredAt: string;
  files: File[];
};

type ExpenseFormState = {
  plate: string;
  category: string;
  amount: string;
  description: string;
  createdAt: string;
  files: File[];
};


type DamageApiResponse = {
  id: number;
  vehicle_id: number | null;
  plate: string;
  title: string;
  description: string | null;
  severity: string;
  occurred_at: string | null;
  created_at: string | null;
  attachments: Array<{
    id: number;
    file_name: string;
    mime_type: string | null;
    size_bytes: number | null;
    content_base64: string;
  }>;
};

type ExpenseApiResponse = {
  id: number;
  vehicle_id: number | null;
  plate: string;
  category: string;
  amount: number;
  description: string | null;
  expense_date: string | null;
  created_at: string | null;
  attachments: Array<{
    id: number;
    file_name: string;
    mime_type: string | null;
    size_bytes: number | null;
    content_base64: string;
  }>;
};

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "vehicles", label: "Araçlar" },
  { id: "vehicle-create", label: "Araç Ekle" },
  { id: "damages", label: "Hasarlar" },
  { id: "expenses", label: "Masraflar" },
  { id: "documents", label: "Belgeler" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  inspection: "Muayene",
  muayene: "Muayene",
  k_document: "K Belgesi",
  k: "K Belgesi",
  k_belgesi: "K Belgesi",
  traffic_insurance: "Trafik Sigortası",
  insurance: "Trafik Sigortası",
  trafik_sigortası: "Trafik Sigortası",
  trafik_sigortasi: "Trafik Sigortası",
  kasko: "Kasko",
  service_oil: "Yağ Bakımı",
  service_general: "Genel Bakım",
};

const DOCUMENT_TYPES = [
  { value: "inspection", label: DOC_TYPE_LABELS.inspection },
  { value: "k_document", label: DOC_TYPE_LABELS.k_document },
  { value: "traffic_insurance", label: DOC_TYPE_LABELS.traffic_insurance },
  { value: "kasko", label: DOC_TYPE_LABELS.kasko },
  { value: "service_oil", label: DOC_TYPE_LABELS.service_oil },
  { value: "service_general", label: DOC_TYPE_LABELS.service_general },
];

const DAMAGE_SEVERITIES: DamageSeverity[] = ["Hafif", "Orta", "Ağır"];

const EXPENSE_CATEGORIES = ["Bakım", "Onarım", "Sigorta", "Vergi", "Yakıt", "Diğer"];

const STATUS_LABELS: Record<string, string> = {
  critical: "Kritik",
  warning: "Yaklaşıyor",
  ok: "Uygun",
  expired: "Süresi Dolmuş",
};

const PASSWORD_STORAGE_KEY = "hys-fleet-admin-password";

const isTabId = (value: string | null): value is TabId =>
  value !== null && tabs.some((tab) => tab.id === value);

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

const statusBadgeClass = (status: string | null | undefined) => {
  switch (status) {
    case "critical":
      return "border-rose-400/50 bg-rose-500/20 text-rose-100";
    case "warning":
      return "border-amber-400/50 bg-amber-500/20 text-amber-100";
    case "ok":
      return "border-emerald-400/50 bg-emerald-500/20 text-emerald-100";
    case "expired":
      return "border-slate-500/50 bg-slate-600/30 text-slate-100";
    default:
      return "border-slate-600/60 bg-slate-700/40 text-slate-200";
  }
};

const formatDaysLabel = (days?: number | null) => {
  if (days === null || days === undefined) return "-";
  if (days < 0) return `${Math.abs(days)} gün geçti`;
  if (days === 0) return "Bugün";
  return `${days} gün kaldı`;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value);

const createInitialDamageFormState = (): DamageFormState => ({
  plate: "",
  title: "",
  description: "",
  severity: "Hafif",
  occurredAt: new Date().toISOString().split("T")[0],
  files: [],
});

const createInitialExpenseFormState = (): ExpenseFormState => ({
  plate: "",
  category: EXPENSE_CATEGORIES[0],
  amount: "",
  description: "",
  createdAt: new Date().toISOString().split("T")[0],
  files: [],
});

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const toDataUrl = (mime: string | null, base64Content: string) =>
  `data:${mime ?? "application/octet-stream"};base64,${base64Content}`;

const docTypeLabel = (value: string) => {
  if (!value) return "Belge";
  const key = value.toLowerCase().replace(/\s+/g, "_");
  return DOC_TYPE_LABELS[key] ?? value.replace(/_/g, " ");
};

const DEFAULT_RESPONSIBLE_EMAIL = "yusufege.eren@hysavm.com";

const adaptDamageResponse = (item: DamageApiResponse): DamageEntry => {
  const severity = DAMAGE_SEVERITIES.includes(item.severity as DamageSeverity)
    ? (item.severity as DamageSeverity)
    : "Hafif";
  return {
    id: item.id,
    plate: item.plate,
    title: item.title,
    description: item.description ?? "",
    severity,
    occurredAt: item.occurred_at ?? item.created_at ?? new Date().toISOString(),
    createdAt: item.created_at ?? item.occurred_at ?? new Date().toISOString(),
    attachments: item.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.file_name,
      mimeType: attachment.mime_type ?? null,
      preview: toDataUrl(attachment.mime_type, attachment.content_base64),
      size: attachment.size_bytes ?? null,
    })),
  };
};

const adaptExpenseResponse = (item: ExpenseApiResponse): ExpenseEntry => {
  const expenseDate = item.expense_date ?? item.created_at ?? new Date().toISOString();
  const createdAt = item.created_at ?? expenseDate;
  return {
    id: item.id,
    plate: item.plate,
    category: item.category,
    amount: typeof item.amount === "number" ? item.amount : Number(item.amount ?? 0),
    description: item.description ?? "",
    createdAt,
    expenseDate,
    attachments: item.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.file_name,
      mimeType: attachment.mime_type ?? null,
      preview: toDataUrl(attachment.mime_type, attachment.content_base64),
      size: attachment.size_bytes ?? null,
    })),
  };
};

const extractErrorMessage = async (res: Response) => {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") return data.detail;
      if (typeof data?.error === "string") return data.error;
      if (typeof data?.message === "string") return data.message;
      return JSON.stringify(data);
    } catch {
      return res.statusText || `HTTP ${res.status}`;
    }
  }
  try {
    const text = await res.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return res.statusText || `HTTP ${res.status}`;
};

const flashMessage = (setter: (value: string | null) => void, message: string, timeout = 3500) => {
  setter(message);
  setTimeout(() => setter(null), timeout);
};

export default function DashboardPage() {
  const [docs, setDocs] = useState<UpcomingDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>("vehicles");

  const [adminPassword, setAdminPassword] = useState("");

  const [vehicleForm, setVehicleForm] = useState<VehicleFormState>({
    plate: "",
    make: "",
    model: "",
    year: "",
    responsible_person: "",
  });
  const [vehicleFormBusy, setVehicleFormBusy] = useState(false);
  const [vehicleFormError, setVehicleFormError] = useState<string | null>(null);
  const [vehicleFormMessage, setVehicleFormMessage] = useState<string | null>(null);

  const [quickDocForm, setQuickDocForm] = useState<DocumentFormState>({
    vehicleId: "",
    doc_type: DOCUMENT_TYPES[0]?.value ?? "inspection",
    valid_from: "",
    valid_to: "",
    note: "",
  });
  const [quickDocBusy, setQuickDocBusy] = useState(false);
  const [quickDocError, setQuickDocError] = useState<string | null>(null);
  const [quickDocMessage, setQuickDocMessage] = useState<string | null>(null);

  const [documentForm, setDocumentForm] = useState<DocumentFormState>({
    vehicleId: "",
    doc_type: DOCUMENT_TYPES[0]?.value ?? "inspection",
    valid_from: "",
    valid_to: "",
    note: "",
  });
  const [documentFormBusy, setDocumentFormBusy] = useState(false);
  const [documentFormError, setDocumentFormError] = useState<string | null>(null);
  const [documentFormMessage, setDocumentFormMessage] = useState<string | null>(null);

  const [damageForm, setDamageForm] = useState<DamageFormState>(() => createInitialDamageFormState());
  const [damageLog, setDamageLog] = useState<DamageEntry[]>([]);
  const [damageError, setDamageError] = useState<string | null>(null);
  const [damageMessage, setDamageMessage] = useState<string | null>(null);
  const [damageBusy, setDamageBusy] = useState(false);
  const [damageFileInputKey, setDamageFileInputKey] = useState(() => Date.now());
  const [damageListLoading, setDamageListLoading] = useState(true);
  const [damageListError, setDamageListError] = useState<string | null>(null);
  const [editingDamageId, setEditingDamageId] = useState<number | null>(null);
  const [damageDeleteBusyId, setDamageDeleteBusyId] = useState<number | null>(null);

  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(() => createInitialExpenseFormState());
  const [expenseLog, setExpenseLog] = useState<ExpenseEntry[]>([]);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseMessage, setExpenseMessage] = useState<string | null>(null);
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseFileInputKey, setExpenseFileInputKey] = useState(() => Date.now());
  const [expenseListLoading, setExpenseListLoading] = useState(true);
  const [expenseListError, setExpenseListError] = useState<string | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [expenseDeleteBusyId, setExpenseDeleteBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(PASSWORD_STORAGE_KEY);
    if (stored && stored.trim()) {
      setAdminPassword(stored.trim());
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PASSWORD_STORAGE_KEY, adminPassword);
  }, [adminPassword]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncTabFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      setActiveTab(isTabId(tabParam) ? tabParam : "vehicles");
    };

    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);

  const setTab = (nextTab: TabId) => {
    setActiveTab(nextTab);
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    if (nextTab === "vehicles") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", nextTab);
    }
    window.history.replaceState(null, "", url.toString());
  };

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/documents/upcoming?days=60"));
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const data = (await res.json()) as UpcomingDocument[];
      setDocs(
        data.map((doc) => ({
          ...doc,
          days_left: doc.days_left !== null ? Number(doc.days_left) : null,
        })),
      );
      setDocsError(null);
    } catch (err) {
      console.error(err);
      setDocsError((err as Error).message || "Belgeler çekilirken hata oluştu");
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const loadVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    try {
      const res = await fetch(apiUrl("/api/vehicles"));
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const data = (await res.json()) as Vehicle[];
      setVehicles(data);
      setVehiclesError(null);
    } catch (err) {
      console.error(err);
      setVehiclesError((err as Error).message || "Araçlar çekilirken hata oluştu");
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  const loadDamages = useCallback(async () => {
    setDamageListLoading(true);
    try {
      const res = await fetch(apiUrl("/api/damages"));
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const data = (await res.json()) as DamageApiResponse[];
      setDamageLog(data.map(adaptDamageResponse));
      setDamageListError(null);
    } catch (err) {
      console.error(err);
      setDamageListError((err as Error).message || "Hasar kayıtları çekilirken hata oluştu");
    } finally {
      setDamageListLoading(false);
    }
  }, []);

  const loadExpenses = useCallback(async () => {
    setExpenseListLoading(true);
    try {
      const res = await fetch(apiUrl("/api/expenses"));
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const data = (await res.json()) as ExpenseApiResponse[];
      setExpenseLog(data.map(adaptExpenseResponse));
      setExpenseListError(null);
    } catch (err) {
      console.error(err);
      setExpenseListError((err as Error).message || "Masraf kayıtları çekilirken hata oluştu");
    } finally {
      setExpenseListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  useEffect(() => {
    loadDamages();
  }, [loadDamages]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const groupedByPlate = useMemo(() => {
    const byPlate = new Map<
      string,
      {
        latestStatus: string;
        nextDocument?: UpcomingDocument;
        documents: UpcomingDocument[];
        responsible_person?: string | null;
      }
    >();

    docs.forEach((doc) => {
      const plateInfo = byPlate.get(doc.plate) ?? {
        latestStatus: doc.status,
        nextDocument: undefined,
        documents: [],
        responsible_person: doc.responsible_person ?? null,
      };

      plateInfo.documents.push(doc);
      if (!plateInfo.responsible_person && doc.responsible_person) {
        plateInfo.responsible_person = doc.responsible_person;
      }
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
        responsible_person: info.responsible_person ?? null,
      }))
      .sort((a, b) => a.plate.localeCompare(b.plate, "tr"));
  }, [docs]);

  const handleVehicleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVehicleFormError(null);
    if (!adminPassword.trim()) {
      setVehicleFormError("Yönetici şifresi gerekli.");
      return;
    }
    if (!vehicleForm.plate.trim()) {
      setVehicleFormError("Plaka alanı zorunlu.");
      return;
    }
    if (!vehicleForm.responsible_person.trim()) {
      setVehicleFormError("Sorumlu kişi alanı zorunlu.");
      return;
    }

    setVehicleFormBusy(true);
    try {
      const payload = {
        plate: vehicleForm.plate.trim().toUpperCase(),
        make: vehicleForm.make.trim() || null,
        model: vehicleForm.model.trim() || null,
        year: vehicleForm.year.trim() ? Number(vehicleForm.year.trim()) : null,
        responsible_person: vehicleForm.responsible_person.trim() || null,
        admin_password: adminPassword.trim(),
      };
      const res = await fetch(apiUrl("/api/vehicles"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      setVehicleForm({
        plate: "",
        make: "",
        model: "",
        year: "",
        responsible_person: "",
      });
      flashMessage(setVehicleFormMessage, "Araç kaydedildi");
      await loadVehicles();
    } catch (err) {
      console.error(err);
      setVehicleFormError((err as Error).message || "Araç kaydedilemedi");
    } finally {
      setVehicleFormBusy(false);
    }
  };

  const submitDocumentForm = async (
    event: FormEvent<HTMLFormElement>,
    formState: DocumentFormState,
    setBusy: (value: boolean) => void,
    setError: (value: string | null) => void,
    setMessage: (value: string | null) => void,
    resetForm: () => void,
  ) => {
    event.preventDefault();
    setError(null);
    if (!adminPassword.trim()) {
      setError("Yönetici şifresi gerekli.");
      return;
    }
    if (!formState.vehicleId) {
      setError("Araç seçmelisiniz.");
      return;
    }
    if (!formState.valid_to) {
      setError("Bitiş tarihini giriniz.");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        vehicle_id: Number(formState.vehicleId),
        doc_type: formState.doc_type,
        valid_from: formState.valid_from || null,
        valid_to: formState.valid_to,
        note: formState.note.trim() || null,
        admin_password: adminPassword.trim(),
      };
      const res = await fetch(apiUrl("/api/documents"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      resetForm();
      flashMessage(setMessage, "Belge kaydedildi");
      await loadDocs();
      await loadVehicles();
    } catch (err) {
      console.error(err);
      setError((err as Error).message || "Belge kaydedilemedi");
    } finally {
      setBusy(false);
    }
  };

  const startDamageEdit = (entry: DamageEntry) => {
    setEditingDamageId(entry.id);
    setDamageError(null);
    setDamageMessage(null);
    setDamageForm({
      plate: entry.plate,
      title: entry.title,
      description: entry.description,
      severity: DAMAGE_SEVERITIES.includes(entry.severity) ? entry.severity : "Hafif",
      occurredAt: entry.occurredAt ? entry.occurredAt.slice(0, 10) : createInitialDamageFormState().occurredAt,
      files: [],
    });
    setDamageFileInputKey(Date.now());
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const cancelDamageEdit = () => {
    setEditingDamageId(null);
    setDamageError(null);
    setDamageMessage(null);
    setDamageForm(createInitialDamageFormState());
    setDamageFileInputKey(Date.now());
  };

  const startExpenseEdit = (entry: ExpenseEntry) => {
    setEditingExpenseId(entry.id);
    setExpenseError(null);
    setExpenseMessage(null);
    setExpenseForm({
      plate: entry.plate,
      category: EXPENSE_CATEGORIES.includes(entry.category) ? entry.category : EXPENSE_CATEGORIES[0],
      amount: Number.isFinite(entry.amount) ? String(entry.amount) : "",
      description: entry.description,
      createdAt: entry.expenseDate ? entry.expenseDate.slice(0, 10) : createInitialExpenseFormState().createdAt,
      files: [],
    });
    setExpenseFileInputKey(Date.now());
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const cancelExpenseEdit = () => {
    setEditingExpenseId(null);
    setExpenseError(null);
    setExpenseMessage(null);
    setExpenseForm(createInitialExpenseFormState());
    setExpenseFileInputKey(Date.now());
  };

  const handleDeleteDamage = async (damageId: number) => {
    if (!adminPassword.trim()) {
      setDamageError("Silme işlemi için yönetici şifresi gerekli.");
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Bu hasar kaydını silmek istediğinize emin misiniz?");
      if (!confirmed) return;
    }
    setDamageError(null);
    setDamageMessage(null);
    setDamageDeleteBusyId(damageId);
    try {
      const res = await fetch(
        apiUrl(`/api/damages/${damageId}?admin_password=${encodeURIComponent(adminPassword.trim())}`),
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      if (editingDamageId === damageId) {
        cancelDamageEdit();
      }
      await loadDamages();
      flashMessage(setDamageMessage, "Hasar kaydı silindi");
    } catch (err) {
      console.error(err);
      setDamageError((err as Error).message || "Hasar kaydı silinemedi");
    } finally {
      setDamageDeleteBusyId(null);
    }
  };

  const handleDeleteExpense = async (expenseId: number) => {
    if (!adminPassword.trim()) {
      setExpenseError("Silme işlemi için yönetici şifresi gerekli.");
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Bu masraf kaydını silmek istediğinize emin misiniz?");
      if (!confirmed) return;
    }
    setExpenseError(null);
    setExpenseMessage(null);
    setExpenseDeleteBusyId(expenseId);
    try {
      const res = await fetch(
        apiUrl(`/api/expenses/${expenseId}?admin_password=${encodeURIComponent(adminPassword.trim())}`),
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      if (editingExpenseId === expenseId) {
        cancelExpenseEdit();
      }
      await loadExpenses();
      flashMessage(setExpenseMessage, "Masraf kaydı silindi");
    } catch (err) {
      console.error(err);
      setExpenseError((err as Error).message || "Masraf kaydı silinemedi");
    } finally {
      setExpenseDeleteBusyId(null);
    }
  };

  const handleDamageSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDamageError(null);
    if (!adminPassword.trim()) {
      setDamageError("Yönetici şifresi gerekli.");
      return;
    }
    if (!damageForm.plate.trim() || !damageForm.title.trim()) {
      setDamageError("Plaka ve başlık alanları zorunlu.");
      return;
    }

    setDamageBusy(true);
    try {
      const attachmentPayloads =
        damageForm.files.length > 0
          ? await Promise.all(
              damageForm.files.map(async (file) => {
                const dataUrl = await readFileAsDataUrl(file);
                const [meta, base64Content] = dataUrl.split(",");
                const mimeMatch = meta?.match(/^data:(.*?);base64$/);
                return {
                  file_name: file.name,
                  mime_type: mimeMatch?.[1] ?? file.type ?? "application/octet-stream",
                  content_base64: base64Content ?? "",
                };
              }),
            )
          : [];
      const basePayload = {
        plate: damageForm.plate.trim().toUpperCase(),
        title: damageForm.title.trim(),
        description: damageForm.description.trim() || null,
        severity: damageForm.severity,
        occurred_at: damageForm.occurredAt,
      };
      if (editingDamageId) {
        const res = await fetch(apiUrl(`/api/damages/${editingDamageId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...basePayload,
            attachments: attachmentPayloads,
            admin_password: adminPassword.trim(),
          }),
        });
        if (!res.ok) throw new Error(await extractErrorMessage(res));
        await res.json();
        await loadDamages();
        setEditingDamageId(null);
        flashMessage(setDamageMessage, "Hasar güncellendi");
      } else {
        const res = await fetch(apiUrl("/api/damages"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...basePayload,
            attachments: attachmentPayloads,
            admin_password: adminPassword.trim(),
          }),
        });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      await res.json();
      await loadDamages();
      flashMessage(setDamageMessage, "Hasar kaydı eklendi");
    }
    setDamageListError(null);
    setDamageForm(createInitialDamageFormState());
    setEditingDamageId(null);
    setDamageFileInputKey(Date.now());
  } catch (err) {
    console.error(err);
    setDamageError((err as Error).message || "Hasar kaydedilemedi");
    } finally {
      setDamageBusy(false);
    }
  };

  const handleExpenseSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setExpenseError(null);
    if (!adminPassword.trim()) {
      setExpenseError("Yönetici şifresi gerekli.");
      return;
    }
    if (!expenseForm.plate.trim()) {
      setExpenseError("Plaka alanı zorunlu.");
      return;
    }
    const parsedAmount = Number(expenseForm.amount.replace(",", "."));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setExpenseError("Geçerli bir tutar giriniz.");
      return;
    }

    setExpenseBusy(true);
    try {
      const attachmentsPayload =
        expenseForm.files.length > 0
          ? await Promise.all(
              expenseForm.files.map(async (file) => {
                const dataUrl = await readFileAsDataUrl(file);
                const [meta, base64Content] = dataUrl.split(",");
                const mimeMatch = meta?.match(/^data:(.*?);base64$/);
                return {
                  file_name: file.name,
                  mime_type: mimeMatch?.[1] ?? file.type ?? "application/octet-stream",
                  content_base64: base64Content ?? "",
                };
              }),
            )
          : [];
      const basePayload = {
        plate: expenseForm.plate.trim().toUpperCase(),
        category: expenseForm.category,
        amount: parsedAmount,
        description: expenseForm.description.trim() || null,
      };
      if (editingExpenseId) {
        const res = await fetch(apiUrl(`/api/expenses/${editingExpenseId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...basePayload,
            expense_date: expenseForm.createdAt,
            attachments: attachmentsPayload,
            admin_password: adminPassword.trim(),
          }),
        });
        if (!res.ok) throw new Error(await extractErrorMessage(res));
        await res.json();
        await loadExpenses();
        setEditingExpenseId(null);
        flashMessage(setExpenseMessage, "Masraf güncellendi");
      } else {
        const res = await fetch(apiUrl("/api/expenses"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...basePayload,
            expense_date: expenseForm.createdAt,
            attachments: attachmentsPayload,
            admin_password: adminPassword.trim(),
          }),
        });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      await res.json();
      await loadExpenses();
      flashMessage(setExpenseMessage, "Masraf kaydı eklendi");
    }
    setExpenseListError(null);
    setExpenseForm(createInitialExpenseFormState());
    setEditingExpenseId(null);
    setExpenseFileInputKey(Date.now());
  } catch (err) {
    console.error(err);
    setExpenseError((err as Error).message || "Masraf kaydedilemedi");
    } finally {
      setExpenseBusy(false);
    }
  };

  const totalExpense = useMemo(
    () => expenseLog.reduce((sum, entry) => sum + (Number.isFinite(entry.amount) ? entry.amount : 0), 0),
    [expenseLog],
  );

  const renderTabContent = () => {
    if (activeTab === "vehicles") {
      return (
        <section className="space-y-6">
          <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Araç Listesi</h2>
              <p className="text-sm text-slate-400">
                Filodaki tüm araçlar ve yaklaşan belge durumları. Toplam {vehicles.length} araç görünüyor.
              </p>
            </div>
            <Link
              href="/vehicles"
              className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-500/30"
            >
              Ayrıntılı Araç Yönetimi
            </Link>
          </header>

          {vehiclesError ? (
            <p className="rounded-lg border border-rose-500/40 bg-rose-900/40 p-4 text-sm text-rose-100">{vehiclesError}</p>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/80 shadow-lg shadow-slate-950/40">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Plaka</th>
                  <th className="px-4 py-3 text-left">Marka / Model</th>
                  <th className="px-4 py-3 text-left">Yıl</th>
                  <th className="px-4 py-3 text-left">Belge Sayısı</th>
                  <th className="px-4 py-3 text-left">Son Belge</th>
                  <th className="px-4 py-3 text-left">Durum</th>
                  <th className="px-4 py-3 text-left">Sorumlu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-200">
                {vehiclesLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                      Araç listesi yükleniyor...
                    </td>
                  </tr>
                ) : vehicles.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                      Henüz araç kaydı bulunmuyor.
                    </td>
                  </tr>
                ) : (
                  vehicles.map((vehicle) => (
                    <tr key={vehicle.id} className="hover:bg-slate-800/60">
                      <td className="px-4 py-3 font-semibold text-white">{vehicle.plate}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span>{[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "-"}</span>
                          {vehicle.created_at ? (
                            <span className="text-xs text-slate-400">
                              Kayıt: {new Date(vehicle.created_at).toLocaleDateString("tr-TR")}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">{vehicle.year ?? "-"}</td>
                      <td className="px-4 py-3">{vehicle.document_count}</td>
                      <td className="px-4 py-3">
                        {vehicle.next_valid_to ? (
                          <div className="flex flex-col">
                            <span>{new Date(vehicle.next_valid_to).toLocaleDateString("tr-TR")}</span>
                            <span className="text-xs text-slate-400">{formatDaysLabel(vehicle.days_left)}</span>
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(
                            vehicle.next_status,
                          )}`}
                        >
                          {vehicle.next_status ? STATUS_LABELS[vehicle.next_status] ?? vehicle.next_status : "Belge Yok"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        <div>{vehicle.responsible_person ?? "Tanımlı değil"}</div>
                        <div className="text-[10px] text-slate-500">{DEFAULT_RESPONSIBLE_EMAIL}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Yaklaşan belgeler (60 gün)</h3>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {docsLoading ? (
                <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">
                  Belge verileri yükleniyor...
                </p>
              ) : groupedByPlate.length === 0 ? (
                <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">
                  Yakın tarihte yenilecek belge bulunmuyor.
                </p>
              ) : (
                groupedByPlate.map((vehicle) => (
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
                              {vehicle.nextDocument.doc_label ?? docTypeLabel(vehicle.nextDocument.doc_type)}
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
                          <div className="text-xs text-white/70">
                            Sorumlu Kişi: {vehicle.responsible_person ?? "Tanımlı değil"}
                          </div>
                          <div className="text-[10px] text-white/60">E-posta: {DEFAULT_RESPONSIBLE_EMAIL}</div>
                        </>
                      ) : (
                        <p className="text-sm text-white/70">Takvimde yaklaşan belge bulunmuyor.</p>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      );
    }

    if (activeTab === "vehicle-create") {
      return (
        <section className="space-y-8">
          <header>
            <h2 className="text-2xl font-semibold text-white">Araç ve Belge Yönetimi</h2>
            <p className="mt-1 text-sm text-slate-400">
              Yeni araç kaydı oluşturun ve aynı ekrandan belge ekleyin. Yönetici şifresi tüm işlemler için gereklidir.
            </p>
          </header>

          <div className="grid gap-6 lg:grid-cols-2">
            <form
              className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5"
              onSubmit={handleVehicleSubmit}
            >
              <div>
                <h3 className="text-lg font-semibold text-white">Araç Ekle</h3>
                <p className="text-xs text-slate-400">Plaka, marka ve sorumlu bilgilerini girin.</p>
              </div>
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Plaka</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                placeholder="34 ABC 123"
                value={vehicleForm.plate}
                onChange={(event) => setVehicleForm((prev) => ({ ...prev, plate: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Marka</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                placeholder="Örn. Ford"
                value={vehicleForm.make}
                onChange={(event) => setVehicleForm((prev) => ({ ...prev, make: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Model</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                placeholder="Örn. Transit"
                value={vehicleForm.model}
                onChange={(event) => setVehicleForm((prev) => ({ ...prev, model: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Yıl</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                placeholder="2020"
                value={vehicleForm.year}
                onChange={(event) => setVehicleForm((prev) => ({ ...prev, year: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Sorumlu Kişi</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                placeholder="Örn. Ayşe Yılmaz"
                value={vehicleForm.responsible_person}
                onChange={(event) => setVehicleForm((prev) => ({ ...prev, responsible_person: event.target.value }))}
              />
              <p className="text-[10px] text-slate-500">
                Bildirim e-postaları otomatik olarak {DEFAULT_RESPONSIBLE_EMAIL} adresine gönderilir.
              </p>
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Yönetici Şifresi</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                placeholder="Yönetici şifresi"
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
              />
              {vehicleFormError ? (
                <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {vehicleFormError}
                </p>
              ) : null}
              {vehicleFormMessage ? (
                <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  {vehicleFormMessage}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={vehicleFormBusy}
                className="mt-2 inline-flex items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {vehicleFormBusy ? "Kaydediliyor..." : "Araç Kaydet"}
              </button>
            </form>

            <form
              className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5"
              onSubmit={(event) =>
                submitDocumentForm(
                  event,
                  quickDocForm,
                  setQuickDocBusy,
                  setQuickDocError,
                  setQuickDocMessage,
                  () =>
                    setQuickDocForm({
                      vehicleId: "",
                      doc_type: quickDocForm.doc_type,
                      valid_from: "",
                      valid_to: "",
                      note: "",
                    }),
                )
              }
            >
              <div>
                <h3 className="text-lg font-semibold text-white">Belge Ekle</h3>
                <p className="text-xs text-slate-400">Mevcut araç için hızla belge oluşturun.</p>
              </div>
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Araç</label>
              <select
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                value={quickDocForm.vehicleId}
                onChange={(event) => setQuickDocForm((prev) => ({ ...prev, vehicleId: event.target.value }))}
              >
                <option value="">Araç seçin</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plate} ({[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Model belirtilmedi"})
                  </option>
                ))}
              </select>

              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Belge Türü</label>
              <select
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                value={quickDocForm.doc_type}
                onChange={(event) => setQuickDocForm((prev) => ({ ...prev, doc_type: event.target.value }))}
              >
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>

              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Başlangıç Tarihi</label>
              <input
                type="date"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                value={quickDocForm.valid_from}
                onChange={(event) => setQuickDocForm((prev) => ({ ...prev, valid_from: event.target.value }))}
              />

              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Bitiş Tarihi</label>
              <input
                type="date"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                value={quickDocForm.valid_to}
                onChange={(event) => setQuickDocForm((prev) => ({ ...prev, valid_to: event.target.value }))}
              />

              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Not</label>
              <textarea
                className="min-h-[80px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                placeholder="İsteğe bağlı açıklama"
                value={quickDocForm.note}
                onChange={(event) => setQuickDocForm((prev) => ({ ...prev, note: event.target.value }))}
              />

              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Yönetici Şifresi</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
                placeholder="Yönetici şifresi"
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
              />

              {quickDocError ? (
                <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {quickDocError}
                </p>
              ) : null}
              {quickDocMessage ? (
                <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  {quickDocMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={quickDocBusy}
                className="mt-2 inline-flex items-center justify-center rounded-lg border border-sky-400/40 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 transition hover:border-sky-300/70 hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {quickDocBusy ? "Kaydediliyor..." : "Belge Kaydet"}
              </button>
            </form>
          </div>
        </section>
      );
    }

    if (activeTab === "damages") {
      return (
        <section className="space-y-6">
          <header>
            <h2 className="text-2xl font-semibold text-white">Hasar Takibi</h2>
            <p className="mt-1 text-sm text-slate-400">
              Hasar kayıtlarını oluşturun ve görseller yükleyin. Kayıtlar veritabanında saklanır.
            </p>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <form
              className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5"
              onSubmit={handleDamageSubmit}
            >
              <div className="mb-1 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Hasar Kaydı Oluştur</h3>
                  <p className="text-xs text-slate-400">
                    Plaka, tarih ve hasar detaylarını girin{editingDamageId ? ", ardından kaydı güncelleyin" : ""}.
                  </p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-400/50 bg-rose-500/20 text-rose-100">
                  🛠️
                </span>
              </div>
              {editingDamageId ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  <div className="flex items-center justify-between gap-2">
                    <span>#{editingDamageId} numaralı hasar kaydını düzenliyorsunuz.</span>
                    <button
                      type="button"
                      onClick={cancelDamageEdit}
                      className="rounded border border-amber-300/50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-100 transition hover:border-amber-200/80 hover:bg-amber-400/20"
                    >
                      İptal
                    </button>
                  </div>
                </div>
              ) : null}
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Plaka</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                placeholder="34 ABC 123"
                value={damageForm.plate}
                onChange={(event) => setDamageForm((prev) => ({ ...prev, plate: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Başlık</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                placeholder="Örn. Sağ kapı çizik"
                value={damageForm.title}
                onChange={(event) => setDamageForm((prev) => ({ ...prev, title: event.target.value }))}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Şiddet</label>
                  <select
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                    value={damageForm.severity}
                    onChange={(event) =>
                      setDamageForm((prev) => ({ ...prev, severity: event.target.value as DamageSeverity }))
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
                  <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Tarih</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                    value={damageForm.occurredAt}
                    onChange={(event) => setDamageForm((prev) => ({ ...prev, occurredAt: event.target.value }))}
                  />
                </div>
              </div>
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Açıklama</label>
              <textarea
                className="min-h-[90px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                placeholder="Hasar detaylarını girin"
                value={damageForm.description}
                onChange={(event) => setDamageForm((prev) => ({ ...prev, description: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Fotoğraf / Görsel</label>
              <input
                key={damageFileInputKey}
                type="file"
                accept="image/*"
                multiple
                className="block w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-rose-500/20 file:px-3 file:py-1 file:text-rose-100 hover:file:bg-rose-500/30"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const files = event.target.files ? Array.from(event.target.files) : [];
                  setDamageForm((prev) => ({ ...prev, files }));
                }}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Yönetici Şifresi</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
                placeholder="Yönetici şifresi"
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
              />
              {damageError ? (
                <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {damageError}
                </p>
              ) : null}
              {damageMessage ? (
                <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  {damageMessage}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={damageBusy}
                className="inline-flex items-center justify-center rounded-lg border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-sm font-medium text-rose-100 transition hover:border-rose-300/70 hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {damageBusy ? "Kaydediliyor..." : editingDamageId ? "Hasarı Güncelle" : "Hasar Kaydet"}
              </button>
            </form>

            <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Hasar Kayıtları</h3>
                <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                  {damageLog.length} kayıt
                </span>
              </div>
              {damageListError ? (
                <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                  {damageListError}
                </p>
              ) : damageListLoading ? (
                <p className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
                  Hasar kayıtları yükleniyor...
                </p>
              ) : damageLog.length === 0 ? (
                <p className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
                  Henüz hasar kaydı eklemediniz.
                </p>
              ) : (
                <div className="space-y-3">
                  {damageLog.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-sm shadow-slate-950/20"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span className="font-semibold text-white">{entry.plate}</span>
                        <div className="flex items-center gap-2">
                          <span>{new Date(entry.occurredAt).toLocaleDateString("tr-TR")}</span>
                          <button
                            type="button"
                            onClick={() => startDamageEdit(entry)}
                            className="rounded border border-slate-600/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-emerald-300/60 hover:bg-emerald-500/20 hover:text-emerald-100"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDamage(entry.id)}
                            disabled={damageDeleteBusyId === entry.id}
                            className="rounded border border-rose-400/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-100 transition hover:border-rose-300/80 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:border-slate-600/60 disabled:bg-slate-800 disabled:text-slate-300"
                          >
                            {damageDeleteBusyId === entry.id ? "Siliniyor..." : "Sil"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{entry.title}</p>
                          {entry.description ? (
                            <p className="text-xs text-slate-300">{entry.description}</p>
                          ) : null}
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.25em] ${statusBadgeClass(
                            entry.severity === "Ağır" ? "critical" : entry.severity === "Orta" ? "warning" : "ok",
                          )}`}
                        >
                          {entry.severity}
                        </span>
                      </div>
                      {entry.attachments.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-3">
                          {entry.attachments.map((attachment) => (
                            <figure
                              key={attachment.id}
                              className="flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/80"
                            >
                              <img
                                src={attachment.preview}
                                alt={attachment.name}
                                className="h-24 w-32 object-cover"
                              />
                              <figcaption className="truncate px-2 py-1 text-[11px] text-slate-300">
                                {attachment.name}
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      );
    }

    if (activeTab === "expenses") {
      return (
        <section className="space-y-6">
          <header>
            <h2 className="text-2xl font-semibold text-white">Masraf Yönetimi</h2>
            <p className="mt-1 text-sm text-slate-400">
              Masrafları kategori ve tutara göre kaydedin. Fiş veya fatura görsellerini ekleyin.
            </p>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <form
              className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5"
              onSubmit={handleExpenseSubmit}
            >
              <div className="mb-1 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Masraf Ekle</h3>
                  <p className="text-xs text-slate-400">
                    Plaka, kategori ve tutarı girin{editingExpenseId ? ", ardından kaydı güncelleyin" : ""}.
                  </p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-indigo-400/50 bg-indigo-500/20 text-indigo-100">
                  ₺
                </span>
              </div>
              {editingExpenseId ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  <div className="flex items-center justify-between gap-2">
                    <span>#{editingExpenseId} numaralı masraf kaydını düzenliyorsunuz.</span>
                    <button
                      type="button"
                      onClick={cancelExpenseEdit}
                      className="rounded border border-amber-300/50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-100 transition hover:border-amber-200/80 hover:bg-amber-400/20"
                    >
                      İptal
                    </button>
                  </div>
                </div>
              ) : null}
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Plaka</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                placeholder="34 ABC 123"
                value={expenseForm.plate}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, plate: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Kategori</label>
              <select
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                value={expenseForm.category}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, category: event.target.value }))}
              >
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Tutar</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                placeholder="Örn. 2500"
                value={expenseForm.amount}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Tarih</label>
              <input
                type="date"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                value={expenseForm.createdAt}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, createdAt: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Açıklama</label>
              <textarea
                className="min-h-[90px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                placeholder="Masraf detaylarını girin"
                value={expenseForm.description}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, description: event.target.value }))}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Fiş / Fatura</label>
              <input
                key={expenseFileInputKey}
                type="file"
                accept="image/*,.pdf"
                multiple
                className="block w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-500/20 file:px-3 file:py-1 file:text-indigo-100 hover:file:bg-indigo-500/30"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const files = event.target.files ? Array.from(event.target.files) : [];
                  setExpenseForm((prev) => ({ ...prev, files }));
                }}
              />
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Yönetici Şifresi</label>
              <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                placeholder="Yönetici şifresi"
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
              />
              {expenseError ? (
                <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {expenseError}
                </p>
              ) : null}
              {expenseMessage ? (
                <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  {expenseMessage}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={expenseBusy}
                className="inline-flex items-center justify-center rounded-lg border border-indigo-400/40 bg-indigo-500/20 px-4 py-2 text-sm font-medium text-indigo-100 transition hover:border-indigo-300/70 hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {expenseBusy ? "Kaydediliyor..." : editingExpenseId ? "Masrafı Güncelle" : "Masraf Kaydet"}
              </button>
            </form>

            <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Masraf Kayıtları</h3>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                    {expenseLog.length} kayıt
                  </span>
                  <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-100">
                    {formatCurrency(totalExpense)}
                  </span>
                </div>
              </div>
              {expenseListError ? (
                <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                  {expenseListError}
                </p>
              ) : expenseListLoading ? (
                <p className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
                  Masraf kayıtları yükleniyor...
                </p>
              ) : expenseLog.length === 0 ? (
                <p className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
                  Henüz masraf kaydı eklemediniz.
                </p>
              ) : (
                <div className="space-y-3">
                  {expenseLog.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-sm shadow-slate-950/20"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-2">
                          <span>{new Date(entry.expenseDate).toLocaleDateString("tr-TR")}</span>
                          <button
                            type="button"
                            onClick={() => startExpenseEdit(entry)}
                            className="rounded border border-slate-600/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-emerald-300/60 hover:bg-emerald-500/20 hover:text-emerald-100"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteExpense(entry.id)}
                            disabled={expenseDeleteBusyId === entry.id}
                            className="rounded border border-rose-400/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-100 transition hover:border-rose-300/80 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:border-slate-600/60 disabled:bg-slate-800 disabled:text-slate-300"
                          >
                            {expenseDeleteBusyId === entry.id ? "Siliniyor..." : "Sil"}
                          </button>
                        </div>
                        <span className="inline-flex items-center rounded-full border border-indigo-400/40 bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-100">
                          {entry.category}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm text-slate-200">
                        <span className="font-semibold text-white">{entry.plate}</span>
                        <span>{formatCurrency(entry.amount)}</span>
                      </div>
                      {entry.description ? (
                        <p className="mt-1 text-xs text-slate-300">{entry.description}</p>
                      ) : null}
                      {entry.attachments.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-3">
                          {entry.attachments.map((attachment) => (
                            <figure
                              key={attachment.id}
                              className="flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/80"
                            >
                              {attachment.preview.startsWith("data:application/pdf") ? (
                                <div className="flex h-24 w-32 items-center justify-center bg-slate-800 text-xs text-slate-200">
                                  PDF
                                </div>
                              ) : (
                                <img
                                  src={attachment.preview}
                                  alt={attachment.name}
                                  className="h-24 w-32 object-cover"
                                />
                              )}
                              <figcaption className="truncate px-2 py-1 text-[11px] text-slate-300">
                                {attachment.name}
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="space-y-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Belge Takip Panosu</h2>
            <p className="text-sm text-slate-400">Önümüzdeki 60 gün içinde süresi dolacak belgeler</p>
          </div>
          <span className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-300">
            {docsLoading ? "Yükleniyor..." : `${docs.length} belge`}
          </span>
        </header>

        <form
          className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 md:grid-cols-2"
          onSubmit={(event) =>
            submitDocumentForm(
              event,
              documentForm,
              setDocumentFormBusy,
              setDocumentFormError,
              setDocumentFormMessage,
              () =>
                setDocumentForm({
                  vehicleId: "",
                  doc_type: documentForm.doc_type,
                  valid_from: "",
                  valid_to: "",
                  note: "",
                }),
            )
          }
        >
          <div className="md:col-span-2">
            <h3 className="text-lg font-semibold text-white">Belge Ekle</h3>
            <p className="text-xs text-slate-400">Araç seçin ve yeni belge kaydı oluşturun.</p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Araç</label>
            <select
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
              value={documentForm.vehicleId}
              onChange={(event) => setDocumentForm((prev) => ({ ...prev, vehicleId: event.target.value }))}
            >
              <option value="">Araç seçin</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plate} ({[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Model belirtilmedi"})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Belge Türü</label>
            <select
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
              value={documentForm.doc_type}
              onChange={(event) => setDocumentForm((prev) => ({ ...prev, doc_type: event.target.value }))}
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Başlangıç Tarihi</label>
            <input
              type="date"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
              value={documentForm.valid_from}
              onChange={(event) => setDocumentForm((prev) => ({ ...prev, valid_from: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Bitiş Tarihi</label>
            <input
              type="date"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
              value={documentForm.valid_to}
              onChange={(event) => setDocumentForm((prev) => ({ ...prev, valid_to: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Not</label>
            <textarea
              className="min-h-[80px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
              placeholder="İsteğe bağlı açıklama"
              value={documentForm.note}
              onChange={(event) => setDocumentForm((prev) => ({ ...prev, note: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Yönetici Şifresi</label>
            <input
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
              placeholder="Yönetici şifresi"
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-col justify-end gap-2">
            {documentFormError ? (
              <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {documentFormError}
              </p>
            ) : null}
            {documentFormMessage ? (
              <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                {documentFormMessage}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={documentFormBusy}
              className="inline-flex items-center justify-center rounded-lg border border-sky-400/40 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 transition hover:border-sky-300/70 hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {documentFormBusy ? "Kaydediliyor..." : "Belge Kaydet"}
            </button>
          </div>
        </form>

        {docsError ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-900/40 p-4 text-sm text-rose-100">{docsError}</p>
        ) : null}

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {docsLoading ? (
            <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">Belgeler yükleniyor...</p>
          ) : docs.length === 0 ? (
            <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">
              Önümüzdeki 60 gün içinde süresi dolacak belge bulunmuyor.
            </p>
          ) : (
            docs.map((doc) => (
              <article
                key={doc.id ?? doc.doc_id}
                className={`rounded-xl border shadow-lg shadow-slate-900/40 transition hover:-translate-y-1 hover:shadow-slate-800/60 ${statusClass(
                  doc.status,
                )}`}
              >
                <div className="space-y-2 p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm uppercase tracking-wide text-white/70">Plaka</span>
                    <span className="text-lg font-semibold text-white">{doc.plate}</span>
                  </div>
                  <div>
                    <span className="text-sm uppercase tracking-wide text-white/70">Belge Türü</span>
                    <h3 className="text-xl font-semibold capitalize text-white">
                      {doc.doc_label ?? docTypeLabel(doc.doc_type)}
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
                    Sorumlu Kişi: {doc.responsible_person ?? "Tanımlı değil"}
                  </div>
                  <div className="text-xs text-white/60">E-posta: {DEFAULT_RESPONSIBLE_EMAIL}</div>
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
                isActive
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/40"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
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
