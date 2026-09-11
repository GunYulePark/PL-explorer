create table public.analysis_presets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  config jsonb not null,
  is_system_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index analysis_presets_owner_idx on public.analysis_presets (owner_id, created_at desc);
create unique index analysis_presets_system_name_idx on public.analysis_presets (name) where is_system_default;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger analysis_presets_set_updated_at
  before update on public.analysis_presets
  for each row execute procedure public.set_updated_at();

alter table public.analysis_presets enable row level security;

create policy "read own or system presets"
on public.analysis_presets for select to authenticated
using (is_system_default or owner_id = auth.uid());

create policy "create own presets"
on public.analysis_presets for insert to authenticated
with check (owner_id = auth.uid() and not is_system_default);

create policy "update own presets"
on public.analysis_presets for update to authenticated
using (owner_id = auth.uid() and not is_system_default)
with check (owner_id = auth.uid() and not is_system_default);

create policy "delete own presets"
on public.analysis_presets for delete to authenticated
using (owner_id = auth.uid() and not is_system_default);

create policy "admins manage all presets"
on public.analysis_presets for all to authenticated
using (public.is_pnl_admin())
with check (public.is_pnl_admin());
