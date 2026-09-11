create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_pnl_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  source_storage_path text not null unique,
  fiscal_year integer not null check (fiscal_year between 2000 and 2100),
  fiscal_quarter text not null check (fiscal_quarter in ('Q1', 'Q2', 'Q3', 'Q4')),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid default auth.uid() references auth.users(id),
  processed_at timestamptz,
  row_count integer not null default 0,
  valid_row_count integer not null default 0,
  invalid_row_count integer not null default 0,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'completed', 'failed')),
  validation_result jsonb not null default '{}'::jsonb
);

create table public.pl_accounts (
  account_code text primary key,
  account_name text not null,
  parent_account_code text references public.pl_accounts(account_code),
  display_order integer not null,
  account_level integer not null default 1 check (account_level >= 1),
  is_statement_row boolean not null default false,
  source_column_position integer unique,
  source_column_name text,
  created_at timestamptz not null default now()
);

create table public.pl_facts (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_row_number integer not null,
  fiscal_year integer not null,
  fiscal_quarter text not null check (fiscal_quarter in ('Q1', 'Q2', 'Q3', 'Q4')),
  material_type_code text,
  material_type_name text,
  product_hierarchy_code text,
  product_hierarchy_name text,
  product_name text,
  brand text,
  classification text,
  efficacy_group text,
  company_name text,
  country_name text,
  customer_group_code text,
  customer_group_name text,
  category_large text,
  category_middle text,
  category_small text,
  site_code text,
  site_name text,
  account_code text not null references public.pl_accounts(account_code),
  amount numeric(20, 2) not null,
  created_at timestamptz not null default now(),
  unique (import_batch_id, source_row_number, account_code)
);

create index pl_facts_period_account_idx on public.pl_facts (fiscal_year, fiscal_quarter, account_code);
create index pl_facts_product_period_idx on public.pl_facts (product_name, brand, fiscal_year, fiscal_quarter);
create index pl_facts_customer_period_idx on public.pl_facts (customer_group_name, site_name, fiscal_year, fiscal_quarter);

alter table public.profiles enable row level security;
alter table public.import_batches enable row level security;
alter table public.pl_accounts enable row level security;
alter table public.pl_facts enable row level security;

create policy "profiles read own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "admins manage profiles" on public.profiles for all to authenticated using (public.is_pnl_admin()) with check (public.is_pnl_admin());
create policy "authenticated read batches" on public.import_batches for select to authenticated using (true);
create policy "admins manage batches" on public.import_batches for all to authenticated using (public.is_pnl_admin()) with check (public.is_pnl_admin());
create policy "authenticated read accounts" on public.pl_accounts for select to authenticated using (true);
create policy "admins manage accounts" on public.pl_accounts for all to authenticated using (public.is_pnl_admin()) with check (public.is_pnl_admin());
create policy "authenticated read facts" on public.pl_facts for select to authenticated using (true);
create policy "admins manage facts" on public.pl_facts for all to authenticated using (public.is_pnl_admin()) with check (public.is_pnl_admin());

insert into storage.buckets (id, name, public)
values ('raw-data', 'raw-data', false)
on conflict (id) do nothing;

create policy "admins read raw data" on storage.objects for select to authenticated using (bucket_id = 'raw-data' and public.is_pnl_admin());
create policy "admins upload raw data" on storage.objects for insert to authenticated with check (bucket_id = 'raw-data' and public.is_pnl_admin());
create policy "admins delete raw data" on storage.objects for delete to authenticated using (bucket_id = 'raw-data' and public.is_pnl_admin());
