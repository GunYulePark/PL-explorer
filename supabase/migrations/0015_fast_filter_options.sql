create index if not exists pl_facts_batch_year_idx on public.pl_facts (import_batch_id, fiscal_year) where fiscal_year is not null;
create index if not exists pl_facts_batch_product_idx on public.pl_facts (import_batch_id, product_name) where product_name is not null and product_name <> '';
create index if not exists pl_facts_batch_brand_idx on public.pl_facts (import_batch_id, brand) where brand is not null and brand <> '';
create index if not exists pl_facts_batch_customer_idx on public.pl_facts (import_batch_id, customer_group_name) where customer_group_name is not null and customer_group_name <> '';
create index if not exists pl_facts_batch_site_idx on public.pl_facts (import_batch_id, site_name) where site_name is not null and site_name <> '';

create or replace function public.pnl_filter_options(p_dataset uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_batches as materialized (
    select b.id, b.dataset_name, b.source_filename
    from public.import_batches b
    where b.status = 'completed'
      and (p_dataset is null or b.id = p_dataset)
  )
  select jsonb_build_object(
    'datasets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(dataset_name, source_filename)) order by dataset_name, source_filename) from (select id, dataset_name, source_filename from eligible_batches order by dataset_name, source_filename limit 200) datasets), '[]'::jsonb),
    'years', coalesce((select jsonb_agg(fiscal_year order by fiscal_year) from (select distinct f.fiscal_year from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.fiscal_year is not null order by f.fiscal_year limit 100) years), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_name order by product_name) from (select distinct f.product_name from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.product_name is not null and f.product_name <> '' order by f.product_name limit 500) products), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(brand order by brand) from (select distinct f.brand from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.brand is not null and f.brand <> '' order by f.brand limit 500) brands), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(customer_group_name order by customer_group_name) from (select distinct f.customer_group_name from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.customer_group_name is not null and f.customer_group_name <> '' order by f.customer_group_name limit 500) customers), '[]'::jsonb),
    'sites', coalesce((select jsonb_agg(site_name order by site_name) from (select distinct f.site_name from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.site_name is not null and f.site_name <> '' order by f.site_name limit 500) sites), '[]'::jsonb)
  );
$$;

revoke all on function public.pnl_filter_options(uuid) from public, anon, authenticated;
grant execute on function public.pnl_filter_options(uuid) to anon, authenticated;
