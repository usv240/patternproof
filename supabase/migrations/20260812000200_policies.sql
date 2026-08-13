-- Enable RLS before connecting any browser client.
alter table public.shop enable row level security;
alter table public.brief enable row level security;
alter table public.revision enable row level security;
alter table public.requirement enable row level security;
alter table public.feasibility enable row level security;
alter table public.annotation enable row level security;
alter table public.consent enable row level security;
alter table public.approval enable row level security;
alter table public.render_cache enable row level security;

-- Tailors can only access data belonging to shops they own. Customer share-token actions
-- must go through server route handlers; do not expose token-based writes through browser RLS.
create policy shop_owner_access on public.shop for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy brief_owner_access on public.brief for all using (shop_id in (select id from public.shop where owner_id = auth.uid())) with check (shop_id in (select id from public.shop where owner_id = auth.uid()));
create policy revision_owner_access on public.revision for all using (brief_id in (select b.id from public.brief b join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid())) with check (brief_id in (select b.id from public.brief b join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid()));
create policy requirement_owner_access on public.requirement for all using (revision_id in (select r.id from public.revision r join public.brief b on b.id=r.brief_id join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid())) with check (revision_id in (select r.id from public.revision r join public.brief b on b.id=r.brief_id join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid()));
create policy feasibility_owner_access on public.feasibility for all using (requirement_id in (select q.id from public.requirement q join public.revision r on r.id=q.revision_id join public.brief b on b.id=r.brief_id join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid())) with check (requirement_id in (select q.id from public.requirement q join public.revision r on r.id=q.revision_id join public.brief b on b.id=r.brief_id join public.shop s on s.id=b.shop_id where s.owner_id=auth.uid()));
