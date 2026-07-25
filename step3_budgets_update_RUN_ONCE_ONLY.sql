-- ============================================================================
--  Real 2026 budget targets, from the mentors' own planning spreadsheet
--  (פירוט תקציב 2025-26.xlsx), total ₪161,989.90 — matches exactly.
--  Updates the 4 categories that already had a placeholder budget, adds real
--  budgets for the other 8 (fixed UUIDs so this matches import_final.sql).
--  Run once, before import_final.sql.
-- ============================================================================

update public.budgets set amount = 40000   where id = '5c801cc4-bd8f-46a3-871e-e3e90c7a5f28'; -- אלקטרוניקה (full electronics+motors line)
update public.budgets set amount = 28480   where id = '964e1e25-49f0-4639-a7f2-7c22c7d7b2a4'; -- הסעות
update public.budgets set amount = 1800    where id = 'd5e54870-a458-414c-a83c-d21053167676'; -- חומרי גלם (metal share of "מתכות ועצים")
update public.budgets set amount = 0       where id = '0ceae72d-25cc-4f90-b443-f01c42940aa7'; -- רובוט parent — real target now lives on אלקטרוניקה

insert into public.budgets (id, season_id, category_id, amount) values
  ('9004da8b-d71b-4ef5-8760-edff657ac42e', 'd238e6e4-20fa-4fc2-a5fe-aca54b0e340e', '1ad24426-7f8b-4399-955d-aa036bc3547f', 59690),      -- רישום
  ('bb43e12f-9709-4e14-9650-194a5fb396d9', 'd238e6e4-20fa-4fc2-a5fe-aca54b0e340e', 'c3ea0882-f82a-4ced-ae40-b1c15a22f92e', 8319.90),    -- אוכל
  ('21a9c6ad-6ea8-43d2-8dc0-57c831ad4492', 'd238e6e4-20fa-4fc2-a5fe-aca54b0e340e', 'fbe44a93-9648-48c4-8665-8174ca9ea8c0', 6500),       -- מדים
  ('c8d6e2ea-94c8-461a-8371-5dc367ee1851', 'd238e6e4-20fa-4fc2-a5fe-aca54b0e340e', '74605337-e9e4-4aac-82c3-983ecf9b8ef9', 1000),       -- מסיבת סיום
  ('5e895bb5-d46e-45d7-b716-e95609420cd4', 'd238e6e4-20fa-4fc2-a5fe-aca54b0e340e', '0709fe33-1838-4754-a333-ec2ada98ed59', 5000),       -- כלי עבודה ובטיחות
  ('441dac8d-b02d-407d-978a-62c1d3ea9fa0', 'd238e6e4-20fa-4fc2-a5fe-aca54b0e340e', '1426392f-adb0-4f43-bb37-e5274d44ca53', 7200),       -- בניית מגרש (wood share)
  ('6cabda55-de3d-45c4-a1b7-aa6b0893a574', 'd238e6e4-20fa-4fc2-a5fe-aca54b0e340e', 'c89ed470-a99e-40a4-abc9-57c377f78069', 4000),       -- תחזוקת סדנא כללית
  ('a2df71b8-2ce4-414b-8fc9-e1ba9913bc0d', 'd238e6e4-20fa-4fc2-a5fe-aca54b0e340e', '7ac60cf6-da94-4d22-87b4-9004a1a5fef4', 0);         -- תחרויות parent — link only, real targets are on its children
