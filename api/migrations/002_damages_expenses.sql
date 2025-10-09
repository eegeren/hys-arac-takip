create table if not exists damages (
  id serial primary key,
  vehicle_id int references vehicles(id) on delete set null,
  plate text not null,
  title text not null,
  description text,
  severity text not null,
  occurred_at date not null,
  created_at timestamptz default now()
);

create table if not exists damage_attachments (
  id serial primary key,
  damage_id int references damages(id) on delete cascade,
  file_name text not null,
  mime_type text,
  content bytea not null,
  created_at timestamptz default now()
);

create table if not exists expenses (
  id serial primary key,
  vehicle_id int references vehicles(id) on delete set null,
  plate text not null,
  category text not null,
  amount numeric(12,2) not null,
  description text,
  expense_date date not null,
  created_at timestamptz default now()
);

create table if not exists expense_attachments (
  id serial primary key,
  expense_id int references expenses(id) on delete cascade,
  file_name text not null,
  mime_type text,
  content bytea not null,
  created_at timestamptz default now()
);

create index if not exists idx_damages_plate on damages(plate);
create index if not exists idx_expenses_plate on expenses(plate);
