import os
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import smtplib
from typing import List

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

DATABASE_URL = os.environ["DATABASE_URL"]
SMTP_HOST = os.environ.get("SMTP_HOST", "mailhog")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "1025"))
SMTP_USER = os.environ.get("SMTP_USER")
SMTP_PASS = os.environ.get("SMTP_PASS")
MAIL_FROM = os.environ.get("MAIL_FROM", "alerts@example.com")
NOTIFY_THRESHOLDS = [
    int(d.strip()) for d in os.environ.get("NOTIFY_THRESHOLDS", "30,15,7,1").split(",") if d.strip()
]
PANEL_URL = os.environ.get("PANEL_URL", "http://localhost:3000")
TZ = os.environ.get("TZ", "Europe/Istanbul")

app = FastAPI(title="HYS Fleet API")
engine: Engine = create_engine(DATABASE_URL, pool_pre_ping=True)

def get_conn():
    with engine.connect() as conn:
        yield conn

def get_due_documents(conn) -> List[dict]:
    stmt = text("""
        SELECT
            d.id AS document_id,
            v.plate,
            d.doc_type,
            d.valid_to,
            (d.valid_to - CURRENT_DATE) AS days_left
        FROM documents d
        JOIN vehicles v ON v.id = d.vehicle_id
        WHERE d.valid_to >= CURRENT_DATE
          AND d.valid_to <= CURRENT_DATE + INTERVAL '60 days'
        ORDER BY d.valid_to ASC;
    """)
    return [dict(row) for row in conn.execute(stmt).mappings()]

def send_notification(doc: dict, threshold: int):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{doc['plate']} | {doc['doc_type']} belgesi {threshold} gün sonra bitiyor"
    msg["From"] = MAIL_FROM
    msg["To"] = MAIL_FROM
    html = f"""
    <html>
      <body>
        <h3>Belge Bitiş Uyarısı</h3>
        <ul>
          <li>Plaka: {doc['plate']}</li>
          <li>Belge Türü: {doc['doc_type']}</li>
          <li>Bitiş Tarihi: {doc['valid_to'].strftime("%Y-%m-%d")}</li>
          <li>Kalan Gün: {threshold}</li>
        </ul>
        <p>Panel: <a href="{PANEL_URL}">{PANEL_URL}</a></p>
      </body>
    </html>
    """
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        if SMTP_USER and SMTP_PASS:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(MAIL_FROM, [MAIL_FROM], msg.as_string())

def notify_job():
    aware_now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        docs = get_due_documents(conn)
        for doc in docs:
            days_left = doc["days_left"]
            for threshold in NOTIFY_THRESHOLDS:
                if days_left == threshold:
                    exists_stmt = text("""
                        SELECT 1 FROM notifications_log
                        WHERE document_id = :doc_id
                          AND threshold_days = :threshold
                    """)
                    if conn.execute(exists_stmt, {"doc_id": doc["document_id"], "threshold": threshold}).first():
                        continue
                    send_notification(doc, threshold)
                    insert_stmt = text("""
                        INSERT INTO notifications_log (document_id, threshold_days, sent_at)
                        VALUES (:doc_id, :threshold, :sent_at)
                    """)
                    conn.execute(
                        insert_stmt,
                        {"doc_id": doc["document_id"], "threshold": threshold, "sent_at": aware_now},
                    )

@app.on_event("startup")
def schedule_job():
    scheduler = BackgroundScheduler(timezone=TZ, daemon=True)
    trigger = CronTrigger(hour=8, minute=0, timezone=TZ)
    scheduler.add_job(notify_job, trigger=trigger, id="daily_notify")
    scheduler.start()

@app.get("/")
def root():
    return {"status": "ok", "time": datetime.now().isoformat()}

@app.get("/documents/upcoming")
def documents_upcoming(conn=Depends(get_conn)):
    stmt = text("""
        SELECT
            d.id,
            v.plate,
            d.doc_type,
            d.valid_to,
            GREATEST((d.valid_to - CURRENT_DATE), 0) AS days_left
        FROM documents d
        JOIN vehicles v ON v.id = d.vehicle_id
        WHERE d.valid_to >= CURRENT_DATE
          AND d.valid_to <= CURRENT_DATE + INTERVAL '60 days'
        ORDER BY d.valid_to ASC;
    """)
    rows = conn.execute(stmt).mappings().all()
    return [
        {
            "id": row["id"],
            "plate": row["plate"],
            "doc_type": row["doc_type"],
            "valid_to": row["valid_to"].strftime("%Y-%m-%d"),
            "days_left": row["days_left"],
        }
        for row in rows
    ]

@app.get("/vehicles")
def list_vehicles(conn=Depends(get_conn)):
    stmt = text("""
        SELECT id, plate, model, to_char(created_at, 'YYYY-MM-DD""T""HH24:MI:SSZ') AS created_at
        FROM vehicles
        ORDER BY plate ASC;
    """)
    return [dict(row) for row in conn.execute(stmt).mappings()]
