-- ============================================================================
--  Migration 30 — more than one link per shopping item.
--
--  shopping_items.url holds a single address. In practice an item has several:
--  the supplier, a cheaper alternative, the datasheet, the thread where someone
--  explained which variant fits.
--
--  DELIBERATELY NOT a replacement. `url` stays exactly as it is and keeps being
--  written by the app as the FIRST link. That matters for the rollout: this SQL
--  can be run before the new code is deployed and nothing breaks, and if the
--  code is ever rolled back the old build still finds the link it expects.
--  Anything else still reading `url` — the Excel backup in the other repo, for
--  instance — keeps working untouched.
--
--  Re-runnable.
-- ============================================================================

alter table public.shopping_items
  add column if not exists urls text[] not null default '{}';

-- Existing single links become the first entry, so nothing has to be re-typed.
update public.shopping_items
   set urls = array[url]
 where url is not null
   and btrim(url) <> ''
   and cardinality(urls) = 0;

-- A link list with blanks in it is a nuisance to render and a nuisance to
-- reason about; strip them on the way in rather than defending against them at
-- every read site.
create or replace function public.tidy_shopping_urls()
returns trigger
language plpgsql
as $$
begin
  if new.urls is null then
    new.urls := '{}';
  else
    select coalesce(array_agg(u), '{}')
      into new.urls
      from (select distinct btrim(x) as u
              from unnest(new.urls) as x
             where btrim(coalesce(x, '')) <> '') s;
  end if;

  -- Keep the legacy column in step: it is the first link, always.
  new.url := case when cardinality(new.urls) > 0 then new.urls[1] else null end;
  return new;
end $$;

drop trigger if exists trg_tidy_shopping_urls on public.shopping_items;
create trigger trg_tidy_shopping_urls
  before insert or update on public.shopping_items
  for each row execute function public.tidy_shopping_urls();

-- Bring existing rows through the trigger once so url and urls agree from the
-- outset rather than only after the next edit.
update public.shopping_items set urls = urls;
