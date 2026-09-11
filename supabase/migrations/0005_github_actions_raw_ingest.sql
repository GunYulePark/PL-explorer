-- Large RAW files are ingested by the GitHub Actions Python worker.  Keep
-- browser uploads limited to Storage and a controlled import-batch RPC.
drop trigger if exists enqueue_raw_ingestion on public.import_batches;

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
  if p_source_storage_path !~ '(?i)^raw/public/[^/]+\\.(xlsx|csv)$' then
    raise exception 'Only public XLSX or CSV upload paths can create an import.';
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

drop policy if exists "anonymous upload demo raw data" on storage.objects;
create policy "anonymous upload demo raw data"
on storage.objects for insert to anon
with check (
  bucket_id = 'raw-data'
  and (storage.foldername(name))[1] = 'raw'
  and (storage.foldername(name))[2] = 'public'
  and lower(storage.extension(name)) in ('xlsx', 'csv')
);
