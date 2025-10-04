import os, smtplib
from datetime import date, timedelta, datetime, timezone
from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Mapping
from apscheduler.schedulers.background import BackgroundScheduler
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
import httpx


DATABASE_URL = os.getenv("DATABASE_URL")
MAIL_PROVIDER = os.getenv("MAIL_PROVIDER", "RESEND").upper()  # RESEND | SMTP
MAIL_FROM = os.getenv("MAIL_FROM", "bildirim@hys.local")
MAIL_TO = os.getenv("MAIL_TO", "aractakip@hysavm.com")

# SMTP config (fallback veya istenirse birincil)
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT_RAW = os.getenv("SMTP_PORT", "").strip()
SMTP_PORT = int(SMTP_PORT_RAW) if SMTP_PORT_RAW else 587
SMTP_USER = os.getenv("SMTP_USER","")
SMTP_PASS = os.getenv("SMTP_PASS","")

# Resend config
RESEND_API_KEY = os.getenv("RESEND_API_KEY","").strip()
RESEND_BASE_URL = os.getenv("RESEND_BASE_URL","https://api.resend.com")

THRESHOLDS = [int(x) for x in os.getenv("NOTIFY_THRESHOLDS_DAYS","30,15,10,7,1").split(",")]
ALLOWED_DOC_TYPES = {"k_document", "traffic_insurance", "kasko", "inspection"}
PANEL_URL = os.getenv("PANEL_URL","http://localhost:3000")
VEHICLE_ADMIN_PASSWORD = os.getenv("VEHICLE_ADMIN_PASSWORD", "hys123")

engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True)
app = FastAPI(title="HYS Fleet API", version="1.1.0")

allow_origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allow_origins if origin.strip()] or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EMAIL_TEMPLATE = """
<h3>🚨 Araç Belge Uyarısı</h3>
<p><b>Plaka:</b> {plate}<br/>
<b>Belge:</b> {doc_type}<br/>
<b>Bitiş Tarihi:</b> {valid_to} ({days_left} gün kaldı)</p>
<a href="{panel_url}">Web panelde görüntüle</a>
"""


def _document_status(valid_to: date | None) -> str:
    if valid_to is None:
        return "unknown"
    today = date.today()
    delta = (valid_to - today).days
    if delta < 0:
        return "expired"
    if delta <= 7:
        return "critical"
    if delta <= 30:
        return "warning"
    return "ok"

def smtp_available() -> bool:
    return bool(SMTP_HOST) and SMTP_HOST.lower() not in {"mailhog", "localhost", "127.0.0.1"}


def resend_available() -> bool:
    return bool(RESEND_API_KEY)


def send_via_smtp(to_email: str, subject: str, html_body: str):
    if not smtp_available():
        raise RuntimeError("SMTP yapılandırılmadı")
    target = MAIL_TO or to_email
    msg = MIMEMultipart("alternative")
    msg["From"] = MAIL_FROM
    msg["To"] = target
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        if SMTP_USER:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
        s.sendmail(MAIL_FROM, [target], msg.as_string())

def send_via_resend(to_email: str, subject: str, html_body: str):
    if not resend_available():
        raise RuntimeError("RESEND_API_KEY tanımlı değil")
    headers = {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    }
    target = MAIL_TO or to_email
    payload = {
        "from": MAIL_FROM,
        "to": [target],
        "subject": subject,
        "html": html_body
    }
    with httpx.Client(base_url=RESEND_BASE_URL, timeout=20) as client:
        r = client.post("/emails", headers=headers, json=payload)
        r.raise_for_status()
        return r.json()

def send_mail(to_email: str, subject: str, html_body: str):
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
    responsible_email: EmailStr | None = None


class VehicleCreateRequest(VehicleIn):
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
            "trafik sigortası": "traffic_insurance",
            "sigorta": "traffic_insurance",
            "kasko": "kasko",
            "muayene": "inspection",
            "inspection": "inspection",
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

@app.get("/healthz")
def health():
    return {"ok": True, "time": datetime.now().isoformat(), "mail_provider": MAIL_PROVIDER}

@app.get("/vehicles")
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

@app.post("/vehicles", status_code=201)
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

    mail_body = EMAIL_TEMPLATE.format(
        plate=row["plate"],
        doc_type="Yeni Araç Kaydı",
        valid_to=datetime.now().strftime("%Y-%m-%d"),
        days_left=0,
        panel_url=f"{PANEL_URL}/vehicles"
    )
    try:
        send_mail(MAIL_TO, f"Yeni Araç Eklendi: {row['plate']}", mail_body)
    except Exception as exc:
        # Loglamak adına konsola yaz
        print(f"Araç ekleme maili gönderilemedi: {exc}")

    return vehicle_data


@app.delete("/vehicles/{vehicle_id}", status_code=204)
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
    mail_body = f"<p>{summary} plakalı araç sistemden silindi.</p><p>Detaylar için panel: <a href='{PANEL_URL}/vehicles'>{PANEL_URL}/vehicles</a></p>"
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


@app.post("/vehicles/{vehicle_id}/documents", status_code=201)
def create_document(vehicle_id: int, payload: DocumentCreateRequest):
    if payload.admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")

    normal_type = payload.normalized_doc_type
    if normal_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Belge türü yalnızca k_document, traffic_insurance, kasko veya inspection olabilir")

    doc_data = payload.model_dump(exclude={"admin_password"})
    doc_data["vehicle_id"] = vehicle_id
    doc_data["doc_type"] = normal_type

    with engine.begin() as con:
        vehicle = con.execute(
            text("SELECT plate FROM vehicles WHERE id = :id"), {"id": vehicle_id}
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

    days_left = (payload.valid_to - date.today()).days if payload.valid_to else None
    mail_html = EMAIL_TEMPLATE.format(
        plate=vehicle["plate"],
        doc_type=normal_type,
        valid_to=payload.valid_to.strftime("%Y-%m-%d"),
        days_left=days_left if days_left is not None else "-",
        panel_url=f"{PANEL_URL}/vehicles?plate={vehicle['plate']}"
    )
    try:
        send_mail(MAIL_TO, f"Belge Eklendi: {vehicle['plate']} - {normal_type}", mail_html)
    except Exception as exc:
        print(f"Belge ekleme maili gönderilemedi: {exc}")

    if days_left is not None and days_left in THRESHOLDS:
        try:
            send_mail(
                MAIL_TO,
                f"Araç Belge Uyarısı: {vehicle['plate']} - {normal_type} ({days_left}g)",
                EMAIL_TEMPLATE.format(
                    plate=vehicle["plate"],
                    doc_type=normal_type,
                    valid_to=payload.valid_to.strftime("%Y-%m-%d"),
                    days_left=days_left,
                    panel_url=f"{PANEL_URL}/vehicles?plate={vehicle['plate']}"
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


# ---- Convenience endpoint: POST /documents (body içinde vehicle_id) ----
class DocumentCreateWithVehicle(DocumentCreateRequest):
    vehicle_id: int

@app.post("/documents", status_code=201)
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


@app.delete("/documents/{document_id}", status_code=204)
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
        send_mail(MAIL_TO, f"Belge Silindi: {plate} - {row['doc_type']}", mail_html)
    except Exception as exc:
        print(f"Belge silme maili gönderilemedi: {exc}")

    return Response(status_code=204)

@app.get("/expiring")
def expiring(days: int = Query(30, ge=1, le=365)):
    today = date.today()
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

def notify_job():
    today = date.today()
    with engine.begin() as con:
        sql = """
          with due as (
            select d.id as doc_id, v.plate, d.doc_type, d.valid_to, v.responsible_email,
                   (d.valid_to - :today) as days_left
            from documents d
            join vehicles v on v.id=d.vehicle_id
            where d.valid_to >= :today
          )
          select * from due where days_left = any(:thresholds)
          and not exists (
            select 1 from notifications_log nl
            where nl.document_id = due.doc_id and nl.threshold_days = due.days_left
          )
          order by valid_to
        """
        rows = con.execute(text(sql), {"today": today, "thresholds": THRESHOLDS}).mappings().all()

        for r in rows:
            if not r["responsible_email"]:
                continue
            html = EMAIL_TEMPLATE.format(
                plate=r["plate"],
                doc_type=r["doc_type"],
                valid_to=r["valid_to"],
                days_left=r["days_left"],
                panel_url=f"{PANEL_URL}/vehicles?plate={r['plate']}",
            )
            send_mail(
                r["responsible_email"],
                f"Araç Belge Uyarısı: {r['plate']} - {r['doc_type']} ({r['days_left']}g)",
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

# DEBUG: manuel test endpoint'i (sadece dev ortamı)
@app.get("/debug/send_test")
def debug_send_test(to: EmailStr = Query(..., description="Alıcı e-posta")):
    try:
        html = EMAIL_TEMPLATE.format(
            plate="TEST-PLAKA", doc_type="inspection", valid_to=str(date.today()+timedelta(days=5)),
            days_left=5, panel_url=PANEL_URL + "/vehicles"
        )
        res = send_mail(str(to), "Test HYS - Resend Mail", html)
        return {"ok": True, "provider": MAIL_PROVIDER, "result": str(res)}
    except Exception as e:
        return {"ok": False, "provider": MAIL_PROVIDER, "error": str(e)}


@app.get("/documents/upcoming")
def documents_upcoming(days: int = Query(60, ge=1, le=365)):
    return expiring(days)


@app.post("/debug/run_notifications")
def debug_run_notifications(admin_password: str = Query(..., description="Bildirim çalıştırma şifresi")):
    if admin_password != VEHICLE_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Şifre hatalı")
    notify_job()
    return {"ok": True, "ran": True}


scheduler = BackgroundScheduler(timezone=os.getenv("TZ","Europe/Istanbul"))
scheduler.add_job(notify_job, "cron", hour=8, minute=0)
scheduler.start()
