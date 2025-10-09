import os, smtplib, base64, binascii
from datetime import date, timedelta, datetime, timezone
from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from zoneinfo import ZoneInfo
from typing import Mapping
from apscheduler.schedulers.background import BackgroundScheduler
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from sqlalchemy import create_engine, text, bindparam
from sqlalchemy.exc import IntegrityError
import httpx
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse


DATABASE_URL = os.getenv("DATABASE_URL")
MAIL_PROVIDER = os.getenv("MAIL_PROVIDER", "RESEND").upper()
MAIL_FROM = os.getenv("MAIL_FROM", "onboarding@resend.dev")
MAIL_TO = os.getenv("MAIL_TO", "yusufege.eren@hysavm.com")

# SMTP config (fallback veya istenirse birincil)
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT_RAW = os.getenv("SMTP_PORT", "").strip()
SMTP_PORT = int(SMTP_PORT_RAW) if SMTP_PORT_RAW else 587
SMTP_USER = os.getenv("SMTP_USER","")
SMTP_PASS = os.getenv("SMTP_PASS","")

# Resend config
RESEND_API_KEY = os.getenv("RESEND_API_KEY","").strip()
RESEND_BASE_URL = os.getenv("RESEND_BASE_URL","https://api.resend.com")
RESEND_TEST_TO = os.getenv("RESEND_TEST_TO","").strip()  # If set, force all Resend mails to go to this address (sandbox)

THRESHOLDS = [
    int(x) for x in os.getenv("NOTIFY_THRESHOLDS_DAYS", "30,15,10,7,1")
    .replace(" ", "")
    .split(",")
    if x.strip() != ""
]
ALLOWED_DOC_TYPES = {
    "inspection", "k_document", "traffic_insurance", "kasko",
    "service_oil", "service_general"
}
PANEL_URL = os.getenv("PANEL_URL","https://hys-arac-takip-1.onrender.com")
VEHICLE_ADMIN_PASSWORD = os.getenv("VEHICLE_ADMIN_PASSWORD", "hys123")
DAMAGE_SEVERITIES_ALLOWED = {"hafif", "orta", "ağır"}
DAMAGE_SEVERITY_DISPLAY = {"hafif": "Hafif", "orta": "Orta", "ağır": "Ağır"}
ATTACHMENT_MAX_BYTES = int(os.getenv("ATTACHMENT_MAX_BYTES", str(5 * 1024 * 1024)))

engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True)
app = FastAPI(title="HYS Fleet API", version="1.3.0")

allow_origins = os.getenv("CORS_ALLOW_ORIGINS", "https://hys-arac-takip-1.onrender.com").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allow_origins if origin.strip()] or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Static web (Next.js export) ---
STATIC_DIR = os.getenv("STATIC_DIR", "/app/webout")

def _ensure_tables():
    ddl = """
    CREATE TABLE IF NOT EXISTS damages (
      id SERIAL PRIMARY KEY,
      vehicle_id INT REFERENCES vehicles(id) ON DELETE SET NULL,
      plate TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL,
      occurred_at DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS damage_attachments (
      id SERIAL PRIMARY KEY,
      damage_id INT REFERENCES damages(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      content BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      vehicle_id INT REFERENCES vehicles(id) ON DELETE SET NULL,
      plate TEXT NOT NULL,
      category TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      description TEXT,
      expense_date DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS expense_attachments (
      id SERIAL PRIMARY KEY,
      expense_id INT REFERENCES expenses(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      content BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_damages_plate ON damages(plate);
    CREATE INDEX IF NOT EXISTS idx_expenses_plate ON expenses(plate);
    """
    with engine.begin() as con:
        for statement in ddl.strip().split(";"):
            stmt = statement.strip()
            if stmt:
                con.execute(text(stmt))

_ensure_tables()

# SPA fallback: /api dışındaki 404'larda index.html döndür
@app.exception_handler(StarletteHTTPException)
async def spa_fallback(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and not request.url.path.startswith("/api"):
        index_path = os.path.join(STATIC_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


# --- Timezone helpers (Europe/Istanbul default) ---
def _tz():
    try:
        return ZoneInfo(os.getenv("TZ", "Europe/Istanbul"))
    except Exception:
        return timezone.utc

def now_local():
    return datetime.now(_tz())

def today_local():
    return now_local().date()

def days_left_for(d: date | None) -> int | None:
    if d is None:
        return None
    return (d - today_local()).days

EMAIL_TEMPLATE = None  # kept for backward-compatibility; use render_email instead

DOC_TURKISH_LABELS = {
    "inspection": "Muayene",
    "k_document": "K Belgesi",
    "traffic_insurance": "Trafik Sigortası",
    "kasko": "Kasko",
    "service_oil": "Yağ Bakımı",
    "service_general": "Periyodik Bakım",
}

# Genel amaçlı: API parametrelerinden gelen belge türünü normalize et
_DOC_ALIASES = {
    "k belgesi": "k_document",
    "k": "k_document",
    "trafik": "traffic_insurance",
    "trafik_sigortası": "traffic_insurance",
    "trafik sigortası": "traffic_insurance",
    "sigorta": "traffic_insurance",
    "kasko": "kasko",
    "muayene": "inspection",
    "inspection": "inspection",
    "yağ": "service_oil",
    "yag": "service_oil",
    "yağ_bakımı": "service_oil",
    "yag_bakimi": "service_oil",
    "oil": "service_oil",
    "oil_service": "service_oil",
    "servis": "service_general",
    "service": "service_general",
    "bakım": "service_general",
    "bakim": "service_general",
    "periyodik_bakım": "service_general",
    "periyodik bakim": "service_general",
    "maintenance": "service_general",
}

def normalize_doc_type_input(value: str | None) -> str | None:
    if value is None:
        return None
    key = value.strip().lower().replace(" ", "_")
    return _DOC_ALIASES.get(key, key)

def tr_doc_label(code: str) -> str:
    """Belge türünü Türkçe etikete çevirir."""
    if not code:
        return "Belge"
    return DOC_TURKISH_LABELS.get(str(code).lower().strip(), str(code))


def render_email(
    *,
    plate: str,
    doc_type: str,
    valid_to: date | str | None,
    days_left: int | str | None,
    panel_url: str,
    valid_from: date | str | None = None,
    note: str | None = None,
    make: str | None = None,
    model: str | None = None,
    year: int | None = None,
) -> str:
    """Şık, bilgili bir HTML e-posta gövdesi üretir."""
    # Normalize dates to strings (YYYY-MM-DD)
    def _d(v):
        if v is None:
            return "-"
        if isinstance(v, (datetime, date)):
            return v.strftime("%Y-%m-%d")
        return str(v)

    days_text = f"{days_left} gün kaldı" if isinstance(days_left, int) else str(days_left or "-")
    title_type = tr_doc_label(doc_type)

    vehicle_line = " ".join(x for x in [make, model, str(year) if year else None] if x)

    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#0b1220;color:#e6eef4;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#0f172a;border:1px solid #1f2a44;border-radius:12px;padding:24px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:22px">🔔</span>
          <h2 style="margin:0;font-size:20px;color:#fff;">Araç Belge Uyarısı</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#e6eef4;">
          <tr>
            <td style="padding:8px 0;color:#93a4b9;width:160px;">Plaka</td>
            <td style="padding:8px 0;font-weight:600;color:#fff;">{plate}</td>
          </tr>
          {f'<tr><td style="padding:8px 0;color:#93a4b9;">Araç</td><td style="padding:8px 0;">{vehicle_line}</td></tr>' if vehicle_line else ''}
          <tr>
            <td style="padding:8px 0;color:#93a4b9;">Belge</td>
            <td style="padding:8px 0;">{title_type}</td>
          </tr>
          {f'<tr><td style="padding:8px 0;color:#93a4b9;">Başlangıç</td><td style="padding:8px 0;">{_d(valid_from)}</td></tr>' if valid_from else ''}
          <tr>
            <td style="padding:8px 0;color:#93a4b9;">Bitiş Tarihi</td>
            <td style="padding:8px 0;">{_d(valid_to)} <span style=\"background:#0ea5e9;color:#001825;border-radius:999px;padding:2px 8px;margin-left:6px;\">{days_text}</span></td>
          </tr>
          {f'<tr><td style="padding:8px 0;color:#93a4b9;">Not</td><td style="padding:8px 0;white-space:pre-wrap;">{note}</td></tr>' if note else ''}
        </table>

        <div style="margin-top:20px;text-align:center;">
          <a href="{panel_url}" style="background:#22c55e;color:#00140a;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:600;display:inline-block">Web panelde görüntüle</a>
        </div>

        <p style="margin-top:16px;color:#93a4b9;font-size:12px;">Bu e-posta otomatik olarak gönderildi. Yanıtlamanıza gerek yoktur.</p>
      </div>
    </div>
    """


def _document_status(valid_to: date | None) -> str:
    if valid_to is None:
        return "unknown"
    today = today_local()
    delta = (valid_to - today).days
    if delta < 0:
        return "expired"
    if delta <= 7:
        return "critical"
    if delta <= 30:
        return "warning"
    return "ok"

def _decode_base64_content(raw: str) -> bytes:
    data = (raw or "").strip()
    if "," in data:
        data = data.split(",", 1)[1]
    try:
        content = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Geçersiz dosya içeriği")
    if len(content) > ATTACHMENT_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Dosya boyutu sınırı aşıldı")
    return content

def _encode_base64_content(data: bytes | None) -> str:
    if not data:
        return ""
    return base64.b64encode(data).decode("ascii")

def smtp_available() -> bool:
    return bool(SMTP_HOST) and SMTP_HOST.lower() not in {"mailhog", "localhost", "127.0.0.1"}

def resend_available() -> bool:
    return bool(RESEND_API_KEY)

def send_via_smtp(to_email: str, subject: str, html_body: str):
    if not smtp_available():
        raise RuntimeError("SMTP yapılandırılmadı")
    target = to_email or MAIL_TO
    msg = MIMEMultipart("alternative")
    msg["From"] = MAIL_FROM
    msg["To"] = target
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        if SMTP_USER:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
        recipients = [addr.strip() for addr in str(target).split(",") if addr.strip()]
        s.sendmail(MAIL_FROM, recipients, msg.as_string())

def send_via_resend(to_email: str, subject: str, html_body: str):
    if not resend_available():
        raise RuntimeError("RESEND_API_KEY tanımlı değil")
    headers = {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    }
    # In Resend sandbox, override recipient if RESEND_TEST_TO is set
    target_final = RESEND_TEST_TO or (to_email or MAIL_TO)
    payload = {
        "from": MAIL_FROM,
        "to": [target_final],
        **({"bcc": [MAIL_TO]} if (MAIL_TO and not RESEND_TEST_TO) else {}),
        "subject": subject,
        "html": html_body,
    }
    with httpx.Client(base_url=RESEND_BASE_URL, timeout=20) as client:
        r = client.post("/emails", headers=headers, json=payload)
        r.raise_for_status()
        return r.json()

def send_mail(to_email: str, subject: str, html_body: str):
    # Standardize subject prefix for routing rules
    if not subject.startswith("[HYS Araç Uyarı]"):
        subject = f"[HYS Araç Uyarı] {subject}"
    provider = MAIL_PROVIDER
    try:
        if provider == "RESEND":
            return send_via_resend(to_email, subject, html_body)
        elif provider == "SMTP":
            return send_via_smtp(to_email, subject, html_body)
        else:
            raise RuntimeError(f"Bilinmeyen MAIL_PROVIDER: {provider}")
    except Exception as e:
        if provider == "RESEND":
            if smtp_available():
                try:
                    return send_via_smtp(to_email, subject, html_body)
                except Exception as e2:
                    raise RuntimeError(f"Resend başarısız: {e}; SMTP fallback da hata verdi: {e2}")
            raise RuntimeError(f"Resend başarısız: {e}")
        else:
            if resend_available():
                try:
                    return send_via_resend(to_email, subject, html_body)
                except Exception as e2:
                    raise RuntimeError(f"SMTP başarısız: {e}; Resend fallback da hata verdi: {e2}")
            raise RuntimeError(f"SMTP başarısız: {e}")

class VehicleIn(BaseModel):
    plate: str
    make: str | None = None
    model: str | None = None
    year: int | None = None
    responsible_email: str | None = None

class VehicleCreateRequest(VehicleIn):
    admin_password: str

# --- Yeni: Araç güncelleme için iskelet ---
class VehicleUpdateRequest(BaseModel):
    plate: str | None = None
    make: str | None = None
    model: str | None = None
    year: int | None = None
    responsible_email: str | None = None
    admin_password: str

class DocumentCreateRequest(BaseModel):
    doc_type: str
    valid_from: date | None = None
    valid_to: date
    note: str | None = None
    admin_password: str

    @property
    def normalized_doc_type(self) -> str:
        value = self.doc_type.strip().lower().replace(" ", "_")
        aliases = {
            "k belgesi": "k_document",
            "k": "k_document",
            "trafik": "traffic_insurance",
            "trafik_sigortası": "traffic_insurance",
            "trafik sigortası": "traffic_insurance",
            "sigorta": "traffic_insurance",
            "kasko": "kasko",
            "muayene": "inspection",
            "inspection": "inspection",
            "yağ": "service_oil",
            "yag": "service_oil",
            "yağ_bakımı": "service_oil",
            "yag_bakimi": "service_oil",
            "oil": "service_oil",
            "oil_service": "service_oil",
            "servis": "service_general",
            "service": "service_general",
            "bakım": "service_general",
            "bakim": "service_general",
            "periyodik_bakım": "service_general",
            "periyodik bakim": "service_general",
            "maintenance": "service_general",
        }
        return aliases.get(value, value)

class DocumentResponse(BaseModel):
    id: int
    doc_type: str
    valid_from: date | None
    valid_to: date
    note: str | None
    days_left: int | None
    status: str

# --- Yeni: Belge güncelleme için iskelet ---
class DocumentUpdateRequest(BaseModel):
    doc_type: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    note: str | None = None
    admin_password: str

class DamageAttachmentPayload(BaseModel):
    file_name: str
    mime_type: str | None = None
    content_base64: str

class DamageCreateRequest(BaseModel):
    plate: str
    title: str
    description: str | None = None
    severity: str
    occurred_at: date
    attachments: list[DamageAttachmentPayload] = []
    admin_password: str

class ExpenseAttachmentPayload(BaseModel):
    file_name: str
    mime_type: str | None = None
    content_base64: str

class ExpenseCreateRequest(BaseModel):
    plate: str
    category: str
    amount: float
    description: str | None = None
    expense_date: date
    attachments: list[ExpenseAttachmentPayload] = []
    admin_password: str

    @property
    def normalized_doc_type(self) -> str | None:
        if self.doc_type is None:
            return None
        value = self.doc_type.strip().lower().replace(" ", "_")
        aliases = {
            "k belgesi": "k_document",
            "k": "k_document",
            "trafik": "traffic_insurance",
            "trafik_sigortası": "traffic_insurance",
            "trafik sigortası": "traffic_insurance",
            "sigorta": "traffic_insurance",
            "kasko": "kasko",
            "muayene": "inspection",
            "inspection": "inspection",
            "yağ": "service_oil",
            "yag": "service_oil",
            "yağ_bakımı": "service_oil",
            "yag_bakimi": "service_oil",
            "oil": "service_oil",
            "oil_service": "service_oil",
            "servis": "service_general",
            "service": "service_general",
            "bakım": "service_general",
            "bakim": "service_general",
            "periyodik_bakım": "service_general",
            "periyodik bakim": "service_general",
            "maintenance": "service_general",
        }
        return aliases.get(value, value)

# --- Sağlık & Uptime (GET + HEAD + meta) ---
def _scheduler_enabled() -> bool:
    return os.getenv("ENABLE_SCHEDULER", "1") == "1"

def _health_payload() -> dict:
    return {
        "ok": True,
        "time": datetime.now().isoformat(),
        "mail_provider": MAIL_PROVIDER,
        "version": "1.3.0",
        "scheduler_enabled": _scheduler_enabled(),
    }

@app.get("/healthz")
def health():
    return _health_payload()

# Extra health aliases for uptime monitors (GET + HEAD)
@app.get("/health")
def health_root():
    """Alias of /healthz for providers expecting /health."""
    return _health_payload()

@app.head("/health")
def health_root_head():
    return Response(status_code=200)

@app.get("/api/health")
def api_health_alias():
    """Alias of /api/healthz for convenience."""
    return _health_payload()

@app.head("/api/health")
def api_health_head():
    return Response(status_code=200)

# ---- Core functions (no direct non-/api routes) ----

def list_vehicles(q: str | None = None):
    base_sql = """
        SELECT
          v.id,
          v.plate,
          v.make,
          v.model,
          v.year,
          v.responsible_email,
          v.created_at
        FROM vehicles v
    """
    conditions: list[str] = []
    params: dict[str, object] = {}
    if q:
        conditions.append("(v.plate ILIKE :q OR v.make ILIKE :q OR v.model ILIKE :q)")
        params["q"] = f"%{q}%"
    sql = base_sql
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY v.plate"

    with engine.begin() as con:
        vehicle_rows = con.execute(text(sql), params).mappings().all()
        document_rows = con.execute(
            text(
                """
                SELECT
                  id,
                  vehicle_id,
                  doc_type,
                  valid_from,
                  valid_to,
                  note,
                  (valid_to - CURRENT_DATE) AS days_left
                FROM documents
                ORDER BY doc_type, valid_to
                """
            )
        ).mappings().all()

    docs_by_vehicle: dict[int, list[dict[str, object]]] = {}
    for doc in document_rows:
        vehicle_id = doc["vehicle_id"]
        docs_by_vehicle.setdefault(vehicle_id, []).append(
            {
                "id": doc["id"],
                "doc_type": doc["doc_type"],
                "valid_from": doc["valid_from"].isoformat() if doc["valid_from"] else None,
                "valid_to": doc["valid_to"].isoformat() if doc["valid_to"] else None,
                "note": doc["note"],
                "days_left": int(doc["days_left"]) if doc["days_left"] is not None else None,
                "status": _document_status(doc["valid_to"]),
            }
        )

    result = []
    for row in vehicle_rows:
        docs = docs_by_vehicle.get(row["id"], [])
        upcoming_candidates = [d for d in docs if d["days_left"] is not None and d["days_left"] >= 0]
        next_doc = min(upcoming_candidates, key=lambda d: d["days_left"], default=None)
        result.append(
            {
                "id": row["id"],
                "plate": row["plate"],
                "make": row["make"],
                "model": row["model"],
                "year": row["year"],
                "responsible_email": row["responsible_email"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                "documents": docs,
                "document_count": len(docs),
                "next_valid_to": next_doc.get("valid_to") if next_doc else None,
                "days_left": next_doc.get("days_left") if next_doc else None,
                "next_status": next_doc.get("status") if next_doc else None,
            }
        )

    return result

def create_vehicle(v: VehicleCreateRequest):
    if v.admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")

    payload = v.model_dump(exclude={"admin_password"})
    with engine.begin() as con:
        try:
            row = (
                con.execute(
                    text(
                        """
                        INSERT INTO vehicles(plate, make, model, year, responsible_email)
                        VALUES (:plate, :make, :model, :year, :responsible_email)
                        RETURNING id, plate, make, model, year, responsible_email, created_at
                        """
                    ),
                    payload,
                ).mappings().first()
            )
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Aynı plakadan zaten var") from exc

    vehicle_data = {
        "id": row["id"],
        "plate": row["plate"],
        "make": row["make"],
        "model": row["model"],
        "year": row["year"],
        "responsible_email": row["responsible_email"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }

    mail_body = render_email(
        plate=row["plate"],
        doc_type="Yeni Araç Kaydı",
        valid_to=datetime.now().date(),
        days_left=0,
        panel_url=f"{PANEL_URL}/vehicles",
    )
    try:
        send_mail(vehicle_data.get('responsible_email') or MAIL_TO, f"Yeni Araç Eklendi: {row['plate']}", mail_body)
    except Exception as exc:
        # Loglamak adına konsola yaz
        print(f"Araç ekleme maili gönderilemedi: {exc}")

    return vehicle_data

# --- Yeni: Araç güncelle ---
def update_vehicle(vehicle_id: int, body: VehicleUpdateRequest):
    if body.admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")

    fields = {}
    if body.plate is not None:
        fields["plate"] = body.plate.strip().upper()
    if body.make is not None:
        fields["make"] = body.make.strip() or None
    if body.model is not None:
        fields["model"] = body.model.strip() or None
    if body.year is not None:
        if not isinstance(body.year, int):
            raise HTTPException(status_code=400, detail="Yıl sayısal olmalı")
        fields["year"] = body.year
    if body.responsible_email is not None:
        fields["responsible_email"] = body.responsible_email.strip() or None

    if not fields:
        with engine.begin() as con:
            row = con.execute(
                text("SELECT id, plate, make, model, year, responsible_email, created_at FROM vehicles WHERE id=:id"),
                {"id": vehicle_id}
            ).mappings().first()
            if row is None:
                raise HTTPException(status_code=404, detail="Araç bulunamadı")
            return {
                "id": row["id"],
                "plate": row["plate"],
                "make": row["make"],
                "model": row["model"],
                "year": row["year"],
                "responsible_email": row["responsible_email"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            }

    set_sql = ", ".join(f"{k} = :{k}" for k in fields.keys())
    params = dict(fields)
    params["id"] = vehicle_id

    with engine.begin() as con:
        try:
            row = con.execute(
                text(f"""
                    UPDATE vehicles
                    SET {set_sql}
                    WHERE id = :id
                    RETURNING id, plate, make, model, year, responsible_email, created_at
                """),
                params,
            ).mappings().first()
        except IntegrityError as exc:
            # duplicate plate vb.
            raise HTTPException(status_code=409, detail="Bu plaka başka bir araçta kayıtlı") from exc

        if row is None:
            raise HTTPException(status_code=404, detail="Araç bulunamadı")

    return {
        "id": row["id"],
        "plate": row["plate"],
        "make": row["make"],
        "model": row["model"],
        "year": row["year"],
        "responsible_email": row["responsible_email"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }

def delete_vehicle(vehicle_id: int, admin_password: str = Query(..., description="Araç silme şifresi")):
    if admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")

    with engine.begin() as con:
        deleted = con.execute(
            text(
                "DELETE FROM vehicles WHERE id = :id RETURNING plate, make, model"
            ),
            {"id": vehicle_id},
        ).mappings().first()
        if deleted is None:
            raise HTTPException(status_code=404, detail="Araç bulunamadı")

    summary = f"{deleted['plate']}" if deleted else str(vehicle_id)
    mail_body = render_email(
        plate=summary,
        doc_type="Araç Silme",
        valid_to=today_local(),
        days_left="-",
        panel_url=f"{PANEL_URL}/vehicles",
    )
    try:
        send_mail(MAIL_TO, f"Araç Silindi: {summary}", mail_body)
    except Exception as exc:
        print(f"Araç silme maili gönderilemedi: {exc}")
    return Response(status_code=204)

def _make_document_response(row: Mapping[str, object]) -> dict[str, object]:
    valid_to = row["valid_to"]
    days_left = row.get("days_left")
    return {
        "id": row["id"],
        "doc_type": row["doc_type"],
        "valid_from": row["valid_from"].isoformat() if row.get("valid_from") else None,
        "valid_to": valid_to.isoformat() if isinstance(valid_to, date) else valid_to,
        "note": row.get("note"),
        "days_left": int(days_left) if days_left is not None else None,
        "status": _document_status(valid_to if isinstance(valid_to, date) else datetime.fromisoformat(valid_to).date()),
    }

def create_document(vehicle_id: int, payload: DocumentCreateRequest):
    if payload.admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")

    normal_type = payload.normalized_doc_type
    if normal_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Belge türü yalnızca inspection, k_document, traffic_insurance, kasko, service_oil veya service_general olabilir")

    doc_data = payload.model_dump(exclude={"admin_password"})
    doc_data["vehicle_id"] = vehicle_id
    doc_data["doc_type"] = normal_type

    with engine.begin() as con:
        vehicle = con.execute(
            text("SELECT plate, make, model, year, responsible_email FROM vehicles WHERE id = :id"), {"id": vehicle_id}
        ).mappings().first()
        if vehicle is None:
            raise HTTPException(status_code=404, detail="Araç bulunamadı")

        row = con.execute(
            text(
                """
                INSERT INTO documents(vehicle_id, doc_type, valid_from, valid_to, note)
                VALUES (:vehicle_id, :doc_type, :valid_from, :valid_to, :note)
                RETURNING id, doc_type, valid_from, valid_to, note
                """
            ),
            doc_data,
        ).mappings().first()

    doc_response = _make_document_response(row)

    days_left = days_left_for(payload.valid_to)

    mail_html = render_email(
        plate=vehicle["plate"],
        doc_type=normal_type,
        valid_to=payload.valid_to,
        days_left=days_left if days_left is not None else "-",
        panel_url=f"{PANEL_URL}/vehicles?plate={vehicle['plate']}",
        valid_from=payload.valid_from,
        note=payload.note,
        make=vehicle.get("make"),
        model=vehicle.get("model"),
        year=vehicle.get("year"),
    )

    # Bilgi maili
    try:
        send_mail(vehicle.get("responsible_email") or MAIL_TO, f"Belge Eklendi: {vehicle['plate']} - {tr_doc_label(normal_type)}", mail_html)
    except Exception as exc:
        print(f"Belge ekleme maili gönderilemedi: {exc}")

    # Eşik uyarısı
    if days_left is not None and days_left in THRESHOLDS:
        try:
            send_mail(
                vehicle.get("responsible_email") or MAIL_TO,
                f"Araç Belge Uyarısı: {vehicle['plate']} - {tr_doc_label(normal_type)} ({days_left}g)",
                render_email(
                    plate=vehicle["plate"],
                    doc_type=normal_type,
                    valid_to=payload.valid_to,
                    days_left=days_left,
                    panel_url=f"{PANEL_URL}/vehicles?plate={vehicle['plate']}",
                    valid_from=payload.valid_from,
                    note=payload.note,
                    make=vehicle.get("make"),
                    model=vehicle.get("model"),
                    year=vehicle.get("year"),
                ),
            )
            with engine.begin() as con:
                con.execute(
                    text(
                        """
                        INSERT INTO notifications_log (document_id, threshold_days, sent_at)
                        VALUES (:doc_id, :threshold, :sent_at)
                        ON CONFLICT (document_id, threshold_days) DO NOTHING
                        """
                    ),
                    {"doc_id": doc_response["id"], "threshold": days_left, "sent_at": datetime.now(timezone.utc)},
                )
        except Exception as exc:
            print(f"Anlık uyarı maili gönderilemedi: {exc}")

    return doc_response

# --- Yeni: Belge güncelle ---
def update_document(document_id: int, body: DocumentUpdateRequest):
    if body.admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")

    fields = {}
    if body.doc_type is not None:
        nd = body.normalized_doc_type
        if nd not in ALLOWED_DOC_TYPES:
            raise HTTPException(status_code=400, detail="Belge türü geçersiz")
        fields["doc_type"] = nd
    if body.valid_from is not None:
        fields["valid_from"] = body.valid_from
    if body.valid_to is not None:
        fields["valid_to"] = body.valid_to
    if body.note is not None:
        fields["note"] = body.note.strip() if body.note else None

    set_sql = ", ".join(f"{k} = :{k}" for k in fields.keys()) if fields else ""
    params = dict(fields)
    params["id"] = document_id

    with engine.begin() as con:
        existing = con.execute(
            text("""
                SELECT id, vehicle_id, doc_type, valid_from, valid_to, note
                FROM documents WHERE id = :id
            """),
            {"id": document_id},
        ).mappings().first()

        if existing is None:
            raise HTTPException(status_code=404, detail="Belge bulunamadı")

        if not fields:
            row = existing
        else:
            row = con.execute(
                text(f"""
                    UPDATE documents
                    SET {set_sql}
                    WHERE id = :id
                    RETURNING id, vehicle_id, doc_type, valid_from, valid_to, note
                """),
                params,
            ).mappings().first()

            if row is None:
                raise HTTPException(status_code=404, detail="Belge bulunamadı")

            if (
                ("valid_to" in fields and existing["valid_to"] != row["valid_to"])
                or ("doc_type" in fields and existing["doc_type"] != row["doc_type"])
            ):
                con.execute(
                    text("DELETE FROM notifications_log WHERE document_id = :id"),
                    {"id": document_id},
                )

    return _make_document_response(row)

# ---- Convenience endpoint: POST /documents (body içinde vehicle_id) ----
class DocumentCreateWithVehicle(DocumentCreateRequest):
    vehicle_id: int

def create_document_with_body(body: DocumentCreateWithVehicle):
    """
    Frontend'in doğrudan /documents üzerine POST atabilmesi için kısayol.
    Mevcut /vehicles/{vehicle_id}/documents mantığını tekrar kullanır.
    Yapıyı bozmadan, sadece kolay erişim sağlar.
    """
    payload = DocumentCreateRequest(
        doc_type=body.doc_type,
        valid_from=body.valid_from,
        valid_to=body.valid_to,
        note=body.note,
        admin_password=body.admin_password,
    )
    return create_document(body.vehicle_id, payload)

def delete_document(document_id: int, admin_password: str = Query(..., description="Belge silme şifresi")):
    if admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")

    with engine.begin() as con:
        row = con.execute(
            text(
                """
                DELETE FROM documents
                WHERE id = :id
                RETURNING id, vehicle_id, doc_type, valid_from, valid_to, note
                """
            ),
            {"id": document_id},
        ).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Belge bulunamadı")

        vehicle = con.execute(
            text("SELECT plate FROM vehicles WHERE id = :id"), {"id": row["vehicle_id"]}
        ).mappings().first()

    plate = vehicle["plate"] if vehicle else "Bilinmiyor"
    mail_html = (
        f"<p>{plate} plakalı aracın {row['doc_type']} belgesi silindi.</p>"
        f"<p>Eski geçerlilik: {row['valid_from']} - {row['valid_to']}</p>"
        f"<p>Panel: <a href='{PANEL_URL}/vehicles?plate={plate}'>{PANEL_URL}/vehicles</a></p>"
    )
    try:
        send_mail(MAIL_TO or (vehicle.get('responsible_email') if isinstance(vehicle, dict) else ''), f"Belge Silindi: {plate} - {row['doc_type']}", mail_html)
    except Exception as exc:
        print(f"Belge silme maili gönderilemedi: {exc}")

    return Response(status_code=204)

def expiring(days: int = Query(30, ge=1, le=365)):
    today = today_local()
    until = today + timedelta(days=days)
    sql = """
      select d.id as doc_id, v.plate, d.doc_type, d.valid_from, d.valid_to, d.note, v.responsible_email,
             (d.valid_to - :t) as days_left
      from documents d
      join vehicles v on v.id=d.vehicle_id
      where d.valid_to between :t and :u
      order by d.valid_to asc
    """
    with engine.begin() as con:
        rows = con.execute(text(sql), {"t": today, "u": until}).mappings().all()
    result = []
    for row in rows:
        result.append(
            {
                "id": row["doc_id"],
                "doc_id": row["doc_id"],
                "plate": row["plate"],
                "doc_type": row["doc_type"],
                "valid_from": row["valid_from"].isoformat() if row["valid_from"] else None,
                "valid_to": row["valid_to"].isoformat(),
                "note": row["note"],
                "responsible_email": row["responsible_email"],
                "days_left": int(row["days_left"]) if row["days_left"] is not None else None,
                "status": _document_status(row["valid_to"]),
            }
        )
    return result

def _serialize_damage_row(row: Mapping[str, object], attachments: list[Mapping[str, object]]):
    return {
        "id": row["id"],
        "vehicle_id": row.get("vehicle_id"),
        "plate": row["plate"],
        "title": row["title"],
        "description": row.get("description"),
        "severity": row["severity"],
        "occurred_at": row["occurred_at"].isoformat() if row.get("occurred_at") else None,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "attachments": [
            {
                "id": att["id"],
                "file_name": att["file_name"],
                "mime_type": att.get("mime_type"),
                "size_bytes": int(att["size_bytes"]) if att.get("size_bytes") is not None else None,
                "content_base64": _encode_base64_content(att.get("content")),
            }
            for att in attachments
        ],
    }

def _serialize_expense_row(row: Mapping[str, object], attachments: list[Mapping[str, object]]):
    amount = row.get("amount")
    try:
        amount_value = float(amount) if amount is not None else 0.0
    except TypeError:
        amount_value = 0.0
    return {
        "id": row["id"],
        "vehicle_id": row.get("vehicle_id"),
        "plate": row["plate"],
        "category": row["category"],
        "amount": amount_value,
        "description": row.get("description"),
        "expense_date": row["expense_date"].isoformat() if row.get("expense_date") else None,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "attachments": [
            {
                "id": att["id"],
                "file_name": att["file_name"],
                "mime_type": att.get("mime_type"),
                "size_bytes": int(att["size_bytes"]) if att.get("size_bytes") is not None else None,
                "content_base64": _encode_base64_content(att.get("content")),
            }
            for att in attachments
        ],
    }

def _resolve_vehicle_id(con, plate: str | None) -> int | None:
    if not plate:
        return None
    row = con.execute(text("SELECT id FROM vehicles WHERE plate = :plate"), {"plate": plate}).mappings().first()
    return row["id"] if row else None

def list_damages():
    with engine.begin() as con:
        rows = con.execute(
            text(
                """
                SELECT d.id, d.vehicle_id, d.plate, d.title, d.description, d.severity,
                       d.occurred_at, d.created_at
                FROM damages d
                ORDER BY d.created_at DESC
                """
            )
        ).mappings().all()
        if not rows:
            return []
        damage_ids = [row["id"] for row in rows]
        attachments_map: dict[int, list[Mapping[str, object]]] = {row["id"]: [] for row in rows}
        att_stmt = (
            text(
                """
                SELECT id, damage_id, file_name, mime_type, octet_length(content) as size_bytes, content
                FROM damage_attachments
                WHERE damage_id IN :ids
                ORDER BY id
                """
            ).bindparams(bindparam("ids", expanding=True))
            if damage_ids
            else None
        )
        if att_stmt is not None:
            for att in con.execute(att_stmt, {"ids": damage_ids}).mappings().all():
                attachments_map.setdefault(att["damage_id"], []).append(att)
        return [_serialize_damage_row(row, attachments_map.get(row["id"], [])) for row in rows]

def _fetch_damage(con, damage_id: int):
    row = con.execute(
        text(
            """
            SELECT d.id, d.vehicle_id, d.plate, d.title, d.description, d.severity,
                   d.occurred_at, d.created_at
            FROM damages d
            WHERE d.id = :id
            """
        ),
        {"id": damage_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Hasar kaydı bulunamadı")
    attachments = con.execute(
        text(
            """
            SELECT id, damage_id, file_name, mime_type, octet_length(content) as size_bytes, content
            FROM damage_attachments
            WHERE damage_id = :id
            ORDER BY id
            """
        ),
        {"id": damage_id},
    ).mappings().all()
    return _serialize_damage_row(row, attachments)

def create_damage(body: DamageCreateRequest):
    if body.admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")
    severity_key = body.severity.strip().lower()
    if severity_key not in DAMAGE_SEVERITIES_ALLOWED:
        raise HTTPException(status_code=400, detail="Şiddet yalnızca Hafif, Orta veya Ağır olabilir")
    severity_label = DAMAGE_SEVERITY_DISPLAY[severity_key]
    plate = body.plate.strip().upper()
    attachments_payload = []
    for att in body.attachments:
        if not att.content_base64:
            continue
        content = _decode_base64_content(att.content_base64)
        if not content:
            continue
        attachments_payload.append(
            {
                "file_name": os.path.basename(att.file_name) if att.file_name else "dosya",
                "mime_type": att.mime_type or "application/octet-stream",
                "content": content,
            }
        )
    with engine.begin() as con:
        vehicle_id = _resolve_vehicle_id(con, plate)
        row = con.execute(
            text(
                """
                INSERT INTO damages (vehicle_id, plate, title, description, severity, occurred_at)
                VALUES (:vehicle_id, :plate, :title, :description, :severity, :occurred_at)
                RETURNING id, vehicle_id, plate, title, description, severity, occurred_at, created_at
                """
            ),
            {
                "vehicle_id": vehicle_id,
                "plate": plate,
                "title": body.title.strip(),
                "description": body.description.strip() if body.description else None,
                "severity": severity_label,
                "occurred_at": body.occurred_at,
            },
        ).mappings().first()
        for att in attachments_payload:
            con.execute(
                text(
                    """
                    INSERT INTO damage_attachments (damage_id, file_name, mime_type, content)
                    VALUES (:damage_id, :file_name, :mime_type, :content)
                    """
                ),
                {
                    "damage_id": row["id"],
                    "file_name": att["file_name"],
                    "mime_type": att["mime_type"],
                    "content": att["content"],
                },
            )
        return _fetch_damage(con, row["id"])

def list_expenses():
    with engine.begin() as con:
        rows = con.execute(
            text(
                """
                SELECT e.id, e.vehicle_id, e.plate, e.category, e.amount, e.description,
                       e.expense_date, e.created_at
                FROM expenses e
                ORDER BY e.expense_date DESC, e.created_at DESC
                """
            )
        ).mappings().all()
        if not rows:
            return []
        expense_ids = [row["id"] for row in rows]
        attachments_map: dict[int, list[Mapping[str, object]]] = {row["id"]: [] for row in rows}
        att_stmt = (
            text(
                """
                SELECT id, expense_id, file_name, mime_type, octet_length(content) as size_bytes, content
                FROM expense_attachments
                WHERE expense_id IN :ids
                ORDER BY id
                """
            ).bindparams(bindparam("ids", expanding=True))
            if expense_ids
            else None
        )
        if att_stmt is not None:
            for att in con.execute(att_stmt, {"ids": expense_ids}).mappings().all():
                attachments_map.setdefault(att["expense_id"], []).append(att)
        return [_serialize_expense_row(row, attachments_map.get(row["id"], [])) for row in rows]

def _fetch_expense(con, expense_id: int):
    row = con.execute(
        text(
            """
            SELECT e.id, e.vehicle_id, e.plate, e.category, e.amount, e.description,
                   e.expense_date, e.created_at
            FROM expenses e
            WHERE e.id = :id
            """
        ),
        {"id": expense_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Masraf kaydı bulunamadı")
    attachments = con.execute(
        text(
            """
            SELECT id, expense_id, file_name, mime_type, octet_length(content) as size_bytes, content
            FROM expense_attachments
            WHERE expense_id = :id
            ORDER BY id
            """
        ),
        {"id": expense_id},
    ).mappings().all()
    return _serialize_expense_row(row, attachments)

def create_expense(body: ExpenseCreateRequest):
    if body.admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")
    plate = body.plate.strip().upper()
    attachments_payload = []
    for att in body.attachments:
        if not att.content_base64:
            continue
        content = _decode_base64_content(att.content_base64)
        if not content:
            continue
        attachments_payload.append(
            {
                "file_name": os.path.basename(att.file_name) if att.file_name else "belge",
                "mime_type": att.mime_type or "application/octet-stream",
                "content": content,
            }
        )
    with engine.begin() as con:
        vehicle_id = _resolve_vehicle_id(con, plate)
        row = con.execute(
            text(
                """
                INSERT INTO expenses (vehicle_id, plate, category, amount, description, expense_date)
                VALUES (:vehicle_id, :plate, :category, :amount, :description, :expense_date)
                RETURNING id, vehicle_id, plate, category, amount, description, expense_date, created_at
                """
            ),
            {
                "vehicle_id": vehicle_id,
                "plate": plate,
                "category": body.category.strip(),
                "amount": body.amount,
                "description": body.description.strip() if body.description else None,
                "expense_date": body.expense_date,
            },
        ).mappings().first()
        for att in attachments_payload:
            con.execute(
                text(
                    """
                    INSERT INTO expense_attachments (expense_id, file_name, mime_type, content)
                    VALUES (:expense_id, :file_name, :mime_type, :content)
                    """
                ),
                {
                    "expense_id": row["id"],
                    "file_name": att["file_name"],
                    "mime_type": att["mime_type"],
                    "content": att["content"],
                },
            )
        return _fetch_expense(con, row["id"])

def notify_job(vehicle_id: int | None = None):
    today = today_local()
    with engine.begin() as con:
        sql = """
          with due as (
            select d.id as doc_id, v.plate, d.doc_type, d.valid_to, v.responsible_email,
                   (d.valid_to - :today) as days_left
            from documents d
            join vehicles v on v.id=d.vehicle_id
            where d.valid_to >= :today
              and (:vid is null or v.id = :vid)
          )
          select * from due where days_left = any(:thresholds)
          and not exists (
            select 1 from notifications_log nl
            where nl.document_id = due.doc_id and nl.threshold_days = due.days_left
          )
          order by valid_to
        """
        rows = con.execute(text(sql), {"today": today, "thresholds": THRESHOLDS, "vid": vehicle_id}).mappings().all()

        for r in rows:
            if not r["responsible_email"]:
                continue
            try:
                html = render_email(
                    plate=r["plate"],
                    doc_type=r["doc_type"],
                    valid_to=r["valid_to"],
                    days_left=r["days_left"],
                    panel_url=f"{PANEL_URL}/vehicles?plate={r['plate']}",
                )
                send_mail(
                    r["responsible_email"],
                    f"Araç Belge Uyarısı: {r['plate']} - {tr_doc_label(r['doc_type'])} ({r['days_left']}g)",
                    html,
                )
                con.execute(
                    text(
                        """
                        insert into notifications_log(document_id, threshold_days, sent_at)
                        values(:d,:t,:sent_at)
                        """
                    ),
                    {
                        "d": r["doc_id"],
                        "t": r["days_left"],
                        "sent_at": datetime.now(timezone.utc),
                    },
                )
            except Exception as e:
                print(f"notify_job mail error for {r['plate']} - {r['doc_type']}: {e}")
                continue

def debug_send_test(to: str = Query(..., description="Alıcı e-posta")):
    try:
        html = render_email(
            plate="TEST-PLAKA",
            doc_type="inspection",
            valid_to=date.today() + timedelta(days=5),
            days_left=5,
            panel_url=PANEL_URL + "/vehicles",
        )
        res = send_mail(str(to), "Test HYS - Resend Mail", html)
        return {"ok": True, "provider": MAIL_PROVIDER, "result": str(res)}
    except Exception as e:
        return {"ok": False, "provider": MAIL_PROVIDER, "error": str(e)}

def documents_upcoming(days: int = Query(60, ge=1, le=365)):
    return expiring(days)

def debug_run_notifications(
    admin_password: str = Query(..., description="Bildirim çalıştırma şifresi"),
    vehicle_id: int | None = Query(None, description="Sadece bu araç için tetikle (opsiyonel)"),
):
    if admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")
    try:
        notify_job(vehicle_id)
        return {"ok": True, "ran": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

if os.getenv("ENABLE_SCHEDULER", "1") == "1":
    scheduler = BackgroundScheduler(timezone=os.getenv("TZ", "Europe/Istanbul"))
    scheduler.add_job(notify_job, "cron", hour=8, minute=0)
    scheduler.start()

# --- Explicit SPA routes for non-/api paths ---
@app.get("/")
def spa_root():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"detail": "Uygulama derlenmiş statik dosyayı bulamadı."}, status_code=404)

@app.get("/vehicles")
@app.get("/vehicles/{rest:path}")
def spa_vehicles(rest: str = ""):
    # Prefer the actual /vehicles static page if it exists (so we don't always load the dashboard)
    vehicles_index = os.path.join(STATIC_DIR, "vehicles", "index.html")
    if os.path.exists(vehicles_index):
        return FileResponse(vehicles_index)
    # Fallback to root index.html (SPA client-side routing can still handle it)
    root_index = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(root_index):
        return FileResponse(root_index)
    return JSONResponse({"detail": "Uygulama derlenmiş statik dosyayı bulamadı."}, status_code=404)

# --- Stats / Dashboard helpers ---
def _stats_summary() -> dict:
    """
    Dashboard için belge ve araç sayıları (toplam, tür bazında, durum bazında).
    """
    with engine.begin() as con:
        # Toplam araç ve toplam belge
        vehicles_total = con.execute(text("SELECT COUNT(*) FROM vehicles")).scalar_one()
        documents_total = con.execute(text("SELECT COUNT(*) FROM documents")).scalar_one()

        # Tür bazında sayılar
        rows_type = con.execute(
            text("""
                SELECT doc_type, COUNT(*) AS c
                FROM documents
                GROUP BY doc_type
            """)
        ).mappings().all()
        by_doc_type: dict[str, int] = {}
        for r in rows_type:
            by_doc_type[str(r["doc_type"])] = int(r["c"])

        # Durum bazında sayılar (expired/critical/warning/ok)
        rows_status = con.execute(
            text("""
                SELECT
                  CASE
                    WHEN valid_to < CURRENT_DATE THEN 'expired'
                    WHEN valid_to >= CURRENT_DATE AND valid_to < CURRENT_DATE + INTERVAL '8 day' THEN 'critical'
                    WHEN valid_to < CURRENT_DATE + INTERVAL '31 day' THEN 'warning'
                    ELSE 'ok'
                  END AS status,
                  COUNT(*) AS c
                FROM documents
                GROUP BY 1
            """)
        ).mappings().all()
        by_status = {"expired": 0, "critical": 0, "warning": 0, "ok": 0}
        for r in rows_status:
            st = str(r["status"])
            by_status[st] = int(r["c"])

    # Türkçe etiketleri de döndürelim (frontend'de kolay kullanım için)
    return {
        "version": "1.3.0",
        "totals": {
            "vehicles": int(vehicles_total),
            "documents": int(documents_total),
        },
        "by_doc_type": by_doc_type,
        "by_status": by_status,
        "labels_tr": DOC_TURKISH_LABELS,
    }

# Belge kapsama/eksik listesi

def _coverage_by_doc_type(doc_type: str, current_only: bool = False) -> dict:
    dt_norm = normalize_doc_type_input(doc_type)
    if not dt_norm or dt_norm not in ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Geçersiz doc_type")

    with engine.begin() as con:
        # İlgili belge türü için her araçtaki en güncel kaydı çek
        latest_docs = con.execute(
            text(
                """
                SELECT DISTINCT ON (vehicle_id)
                       vehicle_id,
                       doc_type,
                       valid_from,
                       valid_to,
                       note
                FROM documents
                WHERE doc_type = :dt
                ORDER BY vehicle_id, valid_to DESC
                """
            ),
            {"dt": dt_norm},
        ).mappings().all()

        # vehicle_id -> latest doc map
        latest_by_vehicle: dict[int, dict] = {int(r["vehicle_id"]): dict(r) for r in latest_docs}

        # Tüm araçları al
        vehicles = con.execute(
            text("SELECT id, plate, make, model, year FROM vehicles ORDER BY plate")
        ).mappings().all()

    with_list = []
    without_list = []
    today = today_local()

    for v in vehicles:
        vid = int(v["id"])
        doc = latest_by_vehicle.get(vid)
        if doc is None:
            # hiç belge yok
            without_list.append({
                "vehicle_id": vid,
                "plate": v["plate"],
                "make": v.get("make"),
                "model": v.get("model"),
                "year": v.get("year"),
            })
            continue

        # Belge var, isteğe göre sadece geçerli olanları süz
        if current_only and doc["valid_to"] and isinstance(doc["valid_to"], (date, datetime)):
            valid_to_date = doc["valid_to"].date() if isinstance(doc["valid_to"], datetime) else doc["valid_to"]
            if valid_to_date < today:
                # süresi dolmuş; current_only isteniyorsa "yok" listesine at
                without_list.append({
                    "vehicle_id": vid,
                    "plate": v["plate"],
                    "make": v.get("make"),
                    "model": v.get("model"),
                    "year": v.get("year"),
                })
                continue

        # with listesine ekle
        vt = doc.get("valid_to")
        if isinstance(vt, datetime):
            vt = vt.date()
        dl = days_left_for(vt) if isinstance(vt, date) else None
        with_list.append({
            "vehicle_id": vid,
            "plate": v["plate"],
            "make": v.get("make"),
            "model": v.get("model"),
            "year": v.get("year"),
            "valid_from": doc.get("valid_from").isoformat() if isinstance(doc.get("valid_from"), (date, datetime)) else doc.get("valid_from"),
            "valid_to": vt.isoformat() if isinstance(vt, date) else vt,
            "days_left": dl,
            "status": _document_status(vt) if isinstance(vt, date) else None,
        })

    # Sıralamalar: with -> en yakın bitiş öne, without -> plaka
    with_list.sort(key=lambda x: (x["days_left"] if x["days_left"] is not None else 10**9))
    without_list.sort(key=lambda x: x["plate"]) 

    return {
        "doc_type": dt_norm,
        "label_tr": tr_doc_label(dt_norm),
        "current_only": bool(current_only),
        "totals": {"with": len(with_list), "without": len(without_list)},
        "with": with_list,
        "without": without_list,
    }


@app.get("/api/stats/coverage")
def stats_coverage_api(doc_type: str = Query(..., description="Belge türü (örn. muayene, trafik_sigortası, k_document, kasko, yağ, servis)"),
                       current_only: bool = Query(False, description="Sadece geçerli (bugünden sonrası) belgeleri dikkate al")):
    """Belirli bir belge türü için hangi araçlarda belge VAR/YOK listesini döner."""
    return _coverage_by_doc_type(doc_type, current_only)

# --- Stats API ---
@app.get("/api/stats/summary")
def stats_summary_api():
    """
    Dashboard özet kutuları için:
    - toplam araç / toplam belge
    - belge türüne göre sayılar
    - durum (expired/critical/warning/ok) dağılımı
    """
    return _stats_summary()

# --- API aliases under /api (backward compatible) ---
@app.get("/api/healthz")
def health_api():
    return _health_payload()

@app.get("/api/debug/vehicles_probe")
def debug_vehicles_probe(q: str | None = None):
    try:
        return list_vehicles(q)
    except Exception as e:
        import traceback
        return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

@app.get("/api/vehicles")
def list_vehicles_api(q: str | None = None):
    return list_vehicles(q)

@app.post("/api/vehicles", status_code=201)
def create_vehicle_api(v: VehicleCreateRequest):
    return create_vehicle(v)

# Yeni: Araç güncelle
@app.put("/api/vehicles/{vehicle_id}")
def update_vehicle_api(vehicle_id: int, body: VehicleUpdateRequest):
    return update_vehicle(vehicle_id, body)

@app.delete("/api/vehicles/{vehicle_id}", status_code=204)
def delete_vehicle_api(vehicle_id: int, admin_password: str = Query(..., description="Araç silme şifresi")):
    return delete_vehicle(vehicle_id, admin_password)

@app.post("/api/vehicles/{vehicle_id}/documents", status_code=201)
def create_document_api(vehicle_id: int, payload: DocumentCreateRequest):
    return create_document(vehicle_id, payload)

@app.post("/api/documents", status_code=201)
def create_document_with_body_api(body: DocumentCreateWithVehicle):
    return create_document_with_body(body)

# Yeni: Belge güncelle
@app.put("/api/documents/{document_id}")
def update_document_api(document_id: int, body: DocumentUpdateRequest):
    return update_document(document_id, body)

@app.delete("/api/documents/{document_id}", status_code=204)
def delete_document_api(document_id: int, admin_password: str = Query(..., description="Belge silme şifresi")):
    return delete_document(document_id, admin_password)

@app.get("/api/expiring")
def expiring_api(days: int = Query(30, ge=1, le=365)):
    return expiring(days)

@app.get("/api/documents/upcoming")
def documents_upcoming_api(days: int = Query(60, ge=1, le=365)):
    return documents_upcoming(days)

@app.get("/api/damages")
def damages_api():
    return list_damages()

@app.post("/api/damages", status_code=201)
def create_damage_api(body: DamageCreateRequest):
    return create_damage(body)

@app.get("/api/expenses")
def expenses_api():
    return list_expenses()

@app.post("/api/expenses", status_code=201)
def create_expense_api(body: ExpenseCreateRequest):
    return create_expense(body)

@app.post("/api/debug/run_notifications")
def debug_run_notifications_api(
    admin_password: str = Query(..., description="Bildirim çalıştırma şifresi"),
    vehicle_id: int | None = Query(None, description="Sadece bu araç için tetikle (opsiyonel)"),
):
    return debug_run_notifications(admin_password, vehicle_id)

@app.get("/api/debug/send_test")
def debug_send_test_api(to: str = Query(..., description="Alıcı e-posta")):
    return debug_send_test(to)

# --- Mount static after API routes (so /api/* takes precedence) ---
if os.path.isdir(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
