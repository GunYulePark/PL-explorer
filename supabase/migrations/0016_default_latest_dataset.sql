-- Keep datasets selectable one at a time.  Options are ordered by the latest
-- uploaded source file, while the field values are scoped to the chosen batch.
create or replace function public.pnl_filter_options(p_dataset uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with available_batches as materialized (
    select b.id, b.dataset_name, b.source_filename, b.uploaded_at
    from public.import_batches b
    where b.status = 'completed'
  ), eligible_batches as materialized (
    select *
    from available_batches
    where p_dataset is null or id = p_dataset
  )
  select jsonb_build_object(
    'datasets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'name', coalesce(dataset_name, source_filename),
        'uploaded_at', uploaded_at
      ) order by uploaded_at desc, id desc)
      from (select id, dataset_name, source_filename, uploaded_at from available_batches order by uploaded_at desc, id desc limit 200) datasets
    ), '[]'::jsonb),
    'years', coalesce((select jsonb_agg(fiscal_year order by fiscal_year) from (select distinct f.fiscal_year from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.fiscal_year is not null order by f.fiscal_year limit 100) years), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_name order by product_name) from (select distinct f.product_name from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.product_name is not null and f.product_name <> '' order by f.product_name limit 500) products), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(brand order by brand) from (select distinct f.brand from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.brand is not null and f.brand <> '' order by f.brand limit 500) brands), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(customer_group_name order by customer_group_name) from (select distinct f.customer_group_name from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.customer_group_name is not null and f.customer_group_name <> '' order by f.customer_group_name limit 500) customers), '[]'::jsonb),
    'sites', coalesce((select jsonb_agg(site_name order by site_name) from (select distinct f.site_name from public.pl_facts f join eligible_batches b on b.id = f.import_batch_id where f.site_name is not null and f.site_name <> '' order by f.site_name limit 500) sites), '[]'::jsonb)
  );
$$;

revoke all on function public.pnl_filter_options(uuid) from public, anon, authenticated;
grant execute on function public.pnl_filter_options(uuid) to anon, authenticated;
