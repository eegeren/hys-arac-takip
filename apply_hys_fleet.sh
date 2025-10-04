#!/usr/bin/env bash
set -euo pipefail

# === Ayarlar ===
PROJECT_NAME="hys-fleet"
DB_NAME="hysfleet"
DB_USER="fleet_user"
DB_PASS="fleet_pass"
TZ="Europe/Istanbul"
SMTP_HOST="mailhog"
SMTP_PORT="1025"
SMTP_USER=""
SMTP_PASS=""
MAIL_FROM="alerts@hysfleet.local"
NOTIFY_THRESHOLDS_DAYS="30,15,7,1"
PANEL_URL="http://localhost:3000"
API_PORT="8000"
WEB_PORT="3000"
MAILHOG_PORT="8025"
PG_PORT="5432"

# === Yardımcılar ===
PROJECT_DIR="$(pwd)/${PROJECT_NAME}"
mkdir -p "${PROJECT_DIR}/api/migrations" "${PROJECT_DIR}/web/app" "${PROJECT_DIR}/web/styles" "${PROJECT_DIR}/web/app/vehicles"

cat <<EOC > "${PROJECT_DIR}/docker-compose.yml"
version: "3.9"

services:
  db:
    image: postgres:16
    container_name: ${PROJECT_NAME}_db
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASS}
      TZ: ${TZ}
    ports:
      - "${PG_PORT}:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./api/migrations:/docker-entrypoint-initdb.d:ro

  mailhog:
    image: mailhog/mailhog:v1.0.1
    container_name: ${PROJECT_NAME}_mailhog
    ports:
      - "${MAILHOG_PORT}:8025"

  api:
    build: ./api
    container_name: ${PROJECT_NAME}_api
    environment:
      DATABASE_URL: postgresql+psycopg://${DB_USER}:${DB_PASS}@db:5432/${DB_NAME}
      TZ: ${TZ}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      MAIL_FROM: ${MAIL_FROM}
      NOTIFY_THRESHOLDS: ${NOTIFY_THRESHOLDS_DAYS}
      PANEL_URL: ${PANEL_URL}
    depends_on:
      - db
      - mailhog
    ports:
      - "${API_PORT}:8000"

  web:
    build: ./web
    container_name: ${PROJECT_NAME}_web
    environment:
      NEXT_PUBLIC_API_BASE_URL: http://localhost:${API_PORT}
    depends_on:
      - api
    ports:
      - "${WEB_PORT}:3000"

volumes:
  db_data:
EOC

cat <<'EOC' > "${PROJECT_DIR}/api/requirements.txt"
fastapi==0.115.0
uvicorn[standard]==0.30.1
SQLAlchemy==2.0.31
psycopg[binary]==3.2.1
APScheduler==3.10.4
python-dotenv==1.0.1
jinja2==3.1.4
EOC

cat <<'EOC' > "${PROJECT_DIR}/api/Dockerfile"
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
EOC

cat <<'EOC' > "${PROJECT_DIR}/api/main.py"
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
EOC

IFS=',' read -ra THRESHOLDS <<< "${NOTIFY_THRESHOLDS_DAYS}"
THRESHOLD_INSERTS=""
for d in "${THRESHOLDS[@]}"; do
  d_trimmed="${d//[[:space:]]/}"
  THRESHOLD_INSERTS+="INSERT INTO notify_thresholds (days_before) VALUES (${d_trimmed}) ON CONFLICT DO NOTHING;\\n"
done

cat <<EOF > "${PROJECT_DIR}/api/migrations/001_init.sql"
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  plate TEXT NOT NULL UNIQUE,
  model TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notify_thresholds (
  id SERIAL PRIMARY KEY,
  days_before INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS notifications_log (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  threshold_days INTEGER NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
  UNIQUE (document_id, threshold_days)
);

INSERT INTO users (email, full_name)
VALUES ('admin@hysfleet.local', 'HYS Fleet Admin')
ON CONFLICT (email) DO NOTHING;

INSERT INTO vehicles (plate, model)
VALUES ('34ABC123', 'Volvo FH16')
ON CONFLICT (plate) DO NOTHING;

WITH upsert_vehicle AS (
  SELECT id FROM vehicles WHERE plate = '34ABC123'
)
INSERT INTO documents (vehicle_id, doc_type, valid_from, valid_to)
SELECT id,
       doc_type,
       DATE '2024-01-01',
       valid_to
FROM upsert_vehicle,
     (VALUES
        ('annual_inspection', DATE '2024-09-15'),
        ('insurance_policy', DATE '2024-10-01'),
        ('k_document', DATE '2024-08-30')
     ) AS docs(doc_type, valid_to)
ON CONFLICT DO NOTHING;

${THRESHOLD_INSERTS}
EOF

cat <<'EOC' > "${PROJECT_DIR}/web/Dockerfile"
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/package.json"
{
  "name": "hys-fleet-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "autoprefixer": "10.4.19",
    "next": "14.2.5",
    "postcss": "8.4.39",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "tailwindcss": "3.4.4"
  },
  "devDependencies": {
    "eslint": "8.57.0",
    "eslint-config-next": "14.2.5",
    "typescript": "5.4.5"
  }
}
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/package-lock.json"
{
  "name": "hys-fleet-web",
  "version": "0.1.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {}
}
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve"
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/tailwind.config.js"
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {}
  },
  plugins: []
};

export default config;
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/postcss.config.js"
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/styles/globals.css"
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-slate-950 text-white;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/next.config.mjs"
const nextConfig = {
  output: "standalone"
};

export default nextConfig;
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/app/layout.tsx"
import "./../styles/globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "HYS Fleet",
  description: "Belge takibi ve araç yönetimi paneli",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
          <header className="mb-10">
            <h1 className="text-3xl font-semibold">HYS Fleet Panel</h1>
            <p className="text-slate-300">60 gün içerisinde süresi dolacak belgeler ve araç listesi</p>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/app/page.tsx"
"use client";

import { useEffect, useState } from "react";

type Document = {
  id: number;
  plate: string;
  doc_type: string;
  valid_to: string;
  days_left: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function DashboardPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch(`${API_BASE}/documents/upcoming`);
        if (!res.ok) throw new Error("API hatası");
        const data = (await res.json()) as Document[];
        setDocs(data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchDocs();
  }, []);

  const colorForDays = (days: number) => {
    if (days <= 7) return "bg-rose-600/80 border-rose-300/60";
    if (days <= 15) return "bg-amber-600/80 border-amber-300/60";
    if (days <= 30) return "bg-emerald-600/80 border-emerald-300/60";
    return "bg-slate-800/80 border-slate-600/60";
  };

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Belge Takip Panosu</h2>
        <span className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-300">
          {loading ? "Yükleniyor..." : `${docs.length} belge`}
        </span>
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {docs.length === 0 && !loading ? (
          <p className="rounded-lg border border-slate-700 bg-slate-800/70 p-4 text-slate-300">
            Önümüzdeki 60 gün içinde süresi dolacak belge bulunmuyor.
          </p>
        ) : (
          docs.map((doc) => (
            <article
              key={doc.id}
              className={`rounded-xl border shadow-lg shadow-slate-900/40 transition hover:-translate-y-1 hover:shadow-slate-800/60 ${colorForDays(doc.days_left)}`}
            >
              <div className="space-y-2 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm uppercase tracking-wide text-white/70">Plaka</span>
                  <span className="text-lg font-semibold text-white">{doc.plate}</span>
                </div>
                <div>
                  <span className="text-sm uppercase tracking-wide text-white/70">Belge Türü</span>
                  <h3 className="text-xl font-semibold capitalize text-white">{doc.doc_type.replace(/_/g, " ")}</h3>
                </div>
                <div className="flex items-center justify-between text-sm text-white/80">
                  <span>Bitiş Tarihi</span>
                  <span>{doc.valid_to}</span>
                </div>
                <div className="flex items-center justify-between text-sm font-medium text-white">
                  <span>Kalan Gün</span>
                  <span>{doc.days_left}</span>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
EOC

cat <<'EOC' > "${PROJECT_DIR}/web/app/vehicles/page.tsx"
"use client";

import { useEffect, useMemo, useState } from "react";

type Vehicle = {
  id: number;
  plate: string;
  model?: string;
  created_at: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const res = await fetch(`${API_BASE}/vehicles`);
        if (!res.ok) throw new Error("API hatası");
        const data = (await res.json()) as Vehicle[];
        setVehicles(data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchVehicles();
  }, []);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return vehicles.filter(
      (v) =>
        v.plate.toLowerCase().includes(term) ||
        (v.model ?? "").toLowerCase().includes(term)
    );
  }, [vehicles, search]);

  return (
    <section>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold text-white">Araç Listesi</h2>
        <p className="text-sm text-slate-400">
          Araç plakası veya modeline göre arama yapın.
        </p>
      </header>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Plaka veya model ara..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-white placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
        <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
          <thead className="bg-slate-800/80 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">Plaka</th>
              <th className="px-4 py-3 text-left">Model</th>
              <th className="px-4 py-3 text-left">Eklenme</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-center text-slate-400" colSpan={3}>
                  Yükleniyor...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-center text-slate-400" colSpan={3}>
                  Sonuç bulunamadı.
                </td>
              </tr>
            ) : (
              filtered.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-slate-800/60">
                  <td className="px-4 py-4 font-medium text-white">{vehicle.plate}</td>
                  <td className="px-4 py-4">{vehicle.model ?? "-"}</td>
                  <td className="px-4 py-4">{new Date(vehicle.created_at).toLocaleString("tr-TR")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
EOC

echo "✅ Proje oluşturuldu: ${PROJECT_DIR}"
echo
echo "🚀 Başlamak için:"
echo "1) cd ${PROJECT_NAME}"
echo "2) docker compose up --build"
echo
echo "🔍 Test komutları:"
echo "curl http://localhost:${API_PORT}/"
echo "curl http://localhost:${API_PORT}/documents/upcoming"
echo "curl http://localhost:${API_PORT}/vehicles"
echo
echo "🌐 URL'ler:"
echo "Web: http://localhost:${WEB_PORT}"
echo "API: http://localhost:${API_PORT}"
echo "MailHog: http://localhost:${MAILHOG_PORT}"
echo "Panel URL: ${PANEL_URL}"
