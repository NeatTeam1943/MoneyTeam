-- ============================================================================
--  Migration 08 — human-readable receipt IDs.
--  Every expense that has a receipt file gets a stable ID like R-000042.
--  That same ID appears in the Excel export AND as the filename inside the
--  "download all receipts" ZIP, so a spreadsheet row and a file always match.
--  Run after 07. Safe to re-run.
-- ============================================================================

create sequence if not exists public.receipt_no_seq;

alter table public.transactions
  add column if not exists receipt_no text;

create unique index if not exists ux_tx_receipt_no
  on public.transactions(receipt_no) where receipt_no is not null;

-- Assign an ID the first time a receipt file is attached, and never change it.
create or replace function public.assign_receipt_no()
returns trigger language plpgsql as $$
begin
  if new.receipt_url is not null and new.receipt_no is null then
    new.receipt_no := 'R-' || lpad(nextval('public.receipt_no_seq')::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_receipt_no on public.transactions;
create trigger trg_assign_receipt_no
  before insert or update on public.transactions
  for each row execute function public.assign_receipt_no();

-- Backfill any expenses that already have a receipt but no ID yet
update public.transactions
   set receipt_no = 'R-' || lpad(nextval('public.receipt_no_seq')::text, 6, '0')
 where receipt_url is not null and receipt_no is null;
