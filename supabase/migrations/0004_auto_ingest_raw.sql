-- The browser can upload a file but cannot create an import batch directly.
-- The generated UUID remains internal to the database and worker.
create or replace function public.create_public_demo_import(
  p_source_filename text,
  p_dataset_name text,
  p_source_storage_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_source_filename is null or length(trim(p_source_filename)) = 0 or length(p_source_filename) > 255 then
    raise exception 'A valid source filename is required.';
  end if;
  if p_dataset_name is null or length(trim(p_dataset_name)) = 0 or length(p_dataset_name) > 255 then
    raise exception 'A valid dataset name is required.';
  end if;
  if p_source_storage_path !~ '(?i)^raw/public/[^/]+\\.xlsx$' then
    raise exception 'Only public XLSX upload paths can create an import.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'raw-data' and name = p_source_storage_path
  ) then
    raise exception 'The uploaded source file does not exist.';
  end if;

  insert into public.import_batches (source_filename, dataset_name, source_storage_path, uploaded_by)
  values (trim(p_source_filename), trim(p_dataset_name), p_source_storage_path, null);
end;
$$;

revoke all on function public.create_public_demo_import(text, text, text) from public, anon, authenticated;
grant execute on function public.create_public_demo_import(text, text, text) to anon;
revoke insert on public.import_batches from anon;

-- Public users receive only bounded filter values and statement-level totals;
-- raw fact rows remain protected by RLS.
create or replace function public.pnl_filter_options(p_dataset uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_batches as (
    select b.id, b.dataset_name, b.source_filename
    from public.import_batches b
    where b.status = 'completed'
      and (p_dataset is null or b.id = p_dataset)
  ), eligible_facts as (
    select f.*
    from public.pl_facts f
    join eligible_batches b on b.id = f.import_batch_id
  )
  select jsonb_build_object(
    'datasets', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(dataset_name, source_filename)) order by dataset_name, source_filename)
      from (select id, dataset_name, source_filename from eligible_batches order by dataset_name, source_filename limit 200) datasets
    ), '[]'::jsonb),
    'years', coalesce((select jsonb_agg(fiscal_year order by fiscal_year) from (select distinct fiscal_year from eligible_facts where fiscal_year is not null order by fiscal_year limit 100) years), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_name order by product_name) from (select distinct product_name from eligible_facts where product_name is not null and product_name <> '' order by product_name limit 500) products), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(brand order by brand) from (select distinct brand from eligible_facts where brand is not null and brand <> '' order by brand limit 500) brands), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(customer_group_name order by customer_group_name) from (select distinct customer_group_name from eligible_facts where customer_group_name is not null and customer_group_name <> '' order by customer_group_name limit 500) customers), '[]'::jsonb),
    'sites', coalesce((select jsonb_agg(site_name order by site_name) from (select distinct site_name from eligible_facts where site_name is not null and site_name <> '' order by site_name limit 500) sites), '[]'::jsonb)
  );
$$;

create or replace function public.pnl_statement_totals(
  p_dataset uuid default null,
  p_years integer[] default null,
  p_year_from integer default null,
  p_year_to integer default null,
  p_products text[] default null,
  p_brands text[] default null,
  p_customers text[] default null,
  p_sites text[] default null
)
returns table (account_code text, amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select f.account_code, sum(f.amount) as amount
  from public.pl_facts f
  join public.import_batches b on b.id = f.import_batch_id
  where b.status = 'completed'
    and f.account_code = any (array['sales', 'cogs', 'gross_profit', 'sga', 'rnd', 'operating_profit']::text[])
    and (p_dataset is null or f.import_batch_id = p_dataset)
    and (coalesce(cardinality(p_years), 0) = 0 or f.fiscal_year = any (p_years))
    and (p_year_from is null or f.fiscal_year >= p_year_from)
    and (p_year_to is null or f.fiscal_year <= p_year_to)
    and (coalesce(cardinality(p_products), 0) = 0 or f.product_name = any (p_products))
    and (coalesce(cardinality(p_brands), 0) = 0 or f.brand = any (p_brands))
    and (coalesce(cardinality(p_customers), 0) = 0 or f.customer_group_name = any (p_customers))
    and (coalesce(cardinality(p_sites), 0) = 0 or f.site_name = any (p_sites))
  group by f.account_code;
$$;

revoke all on function public.pnl_filter_options(uuid) from public, anon, authenticated;
revoke all on function public.pnl_statement_totals(uuid, integer[], integer, integer, text[], text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.pnl_filter_options(uuid) to anon, authenticated;
grant execute on function public.pnl_statement_totals(uuid, integer[], integer, integer, text[], text[], text[], text[]) to anon, authenticated;
