create table if not exists users (
  id serial primary key,
  email text not null unique,
  full_name text,
  role text default 'user',
  created_at timestamptz default now()
);

create table if not exists vehicles (
  id serial primary key,
  plate text not null unique,
  make text,
  model text,
  year int,
  responsible_email text,
  active boolean default true,
  created_at timestamptz default now()
);

-- doc_type: inspection | k_document | insurance | kasko | license ...
create table if not exists documents (
  id serial primary key,
  vehicle_id int references vehicles(id) on delete cascade,
  doc_type text not null,
  valid_from date,
  valid_to date not null,
  note text,
  created_at timestamptz default now()
);

create table if not exists notify_thresholds (
  id serial primary key,
  days_before int not null unique
);

create table if not exists notifications_log (
  id serial primary key,
  document_id int references documents(id) on delete cascade,
  threshold_days int not null,
  sent_at timestamptz default now()
);

insert into notify_thresholds (days_before)
values (30),(15),(7),(1) on conflict do nothing;

-- örnek veri
insert into vehicles (plate, make, model, year, responsible_email)
values ('34ABC123','Ford','Transit',2019,'servis@hys.com')
on conflict (plate) do nothing;

insert into documents (vehicle_id, doc_type, valid_from, valid_to, note)
select id, 'inspection','2024-10-01','2025-10-12','Yıllık muayene' from vehicles where plate='34ABC123'
on conflict do nothing;

insert into documents (vehicle_id, doc_type, valid_from, valid_to, note)
select id, 'k_document','2024-11-01','2025-11-01','K Belgesi' from vehicles where plate='34ABC123'
on conflict do nothing;

insert into documents (vehicle_id, doc_type, valid_from, valid_to, note)
select id, 'traffic_insurance','2025-01-01','2026-01-01','Trafik sigortası' from vehicles where plate='34ABC123'
on conflict do nothing;
