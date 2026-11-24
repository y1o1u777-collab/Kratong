-- Krathong Live. Creates a compatible table if needed. Existing rows and policies are preserved.
begin;

create table if not exists public.krathongs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'ไม่ระบุชื่อ' check (char_length(name) between 1 and 30),
  wish text not null check (char_length(btrim(wish)) between 1 and 180),
  design text not null default 'gold' check (design in ('gold', 'lotus')),
  created_at timestamptz not null default now()
);

create index if not exists krathongs_created_at_idx on public.krathongs (created_at desc);
alter table public.krathongs enable row level security;
grant select, insert on table public.krathongs to service_role;

commit;
