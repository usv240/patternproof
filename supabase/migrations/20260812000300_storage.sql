-- Private image storage. Run after schema.sql and policies.sql.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brief-images',
  'brief-images',
  false,
  10485760,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object keys must begin with the owning shop UUID:
--   {shop_id}/{brief_id}/{revision_id}/{kind}.jpg
create policy "shop owners can read brief images"
on storage.objects for select to authenticated
using (
  bucket_id = 'brief-images'
  and exists (
    select 1 from public.shop
    where shop.id::text = (storage.foldername(name))[1]
      and shop.owner_id = auth.uid()
  )
);

create policy "shop owners can upload brief images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'brief-images'
  and exists (
    select 1 from public.shop
    where shop.id::text = (storage.foldername(name))[1]
      and shop.owner_id = auth.uid()
  )
);

create policy "shop owners can delete brief images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'brief-images'
  and exists (
    select 1 from public.shop
    where shop.id::text = (storage.foldername(name))[1]
      and shop.owner_id = auth.uid()
  )
);
