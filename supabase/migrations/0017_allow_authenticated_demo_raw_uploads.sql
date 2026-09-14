-- The public demo upload flow also needs to work when a browser has an
-- existing Supabase session. Keep exactly the same bounded public path and
-- file restrictions as the anonymous policy.
drop policy if exists "authenticated upload demo raw data" on storage.objects;

create policy "authenticated upload demo raw data"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'raw-data'
  and (storage.foldername(name))[1] = 'raw'
  and (storage.foldername(name))[2] = 'public'
  and lower(storage.extension(name)) = any (array['xlsx', 'csv'])
  and (metadata->>'size')::bigint between 1 and 20971520
);

revoke all on function public.create_public_demo_import(text, text, text) from public, anon, authenticated;
grant execute on function public.create_public_demo_import(text, text, text) to anon, authenticated;
