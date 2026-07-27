-- ============================================================================
--  Migration 14 — import the 2027 shopping list.
--  Run AFTER 13_team_scope.sql.
--
--  Idempotent: an item is skipped if the same season already has a row with
--  that exact name, so re-running never duplicates.
--
--  Before running, check the three "get or create" lists below — anything
--  already in your DB is matched BY NAME and reused; only genuinely missing
--  names are created. Rename them here if your tree uses different words.
-- ============================================================================

do $$
declare
  -- ---- knobs -------------------------------------------------------------
  v_season_name text    := '2027';
  v_usd_ils     numeric := 3.70;   -- rate used for the $ rows in the sheet
  -- ------------------------------------------------------------------------
  v_season   uuid;
  v_cat      uuid;
  v_lvl      uuid;
  v_price    numeric;
  v_item     jsonb;
  v_rec      record;
  v_added    int := 0;
  v_skipped  int := 0;
  v_items    jsonb := '[
  {
    "name": "loctite 243",
    "level": "צריך דחוף",
    "price": 28.97,
    "currency": "ILS",
    "qty": 1,
    "url": "https://aliexpress.com/item/1005009280336848.html",
    "sku": null,
    "vendor": "AliExpress",
    "category": "תחזוקת סדנא כללית",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה · מותג: Loctite"
  },
  {
    "name": "FTC 2026-27 BIOBUZZ™",
    "level": "צריך להמשך השנה",
    "price": 2900,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.saad-robot.com/am-5850",
    "sku": "am-5850_Full",
    "vendor": "חנות ROBOT",
    "category": "רובוט",
    "status": "ordered",
    "team_scope": "ftc",
    "notes": "צוות: Mechanic"
  },
  {
    "name": "MK5n Swerve Module",
    "level": "צריך להמשך השנה",
    "price": 2000,
    "currency": "ILS",
    "qty": 4,
    "url": "https://www.saad-robot.com/mk5i-swerve-module",
    "sku": "MK5i Swerve Module",
    "vendor": "חנות ROBOT",
    "category": "מנועים",
    "status": "ordered",
    "team_scope": "frc",
    "notes": "צוות: בנייה"
  },
  {
    "name": "CANCoder",
    "level": "צריך להמשך השנה",
    "price": 400,
    "currency": "ILS",
    "qty": 4,
    "url": "https://www.saad-robot.com/cancoder",
    "sku": "19-676768",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "ordered",
    "team_scope": "frc",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "Kraken Powered by TalonFX X60",
    "level": "צריך להמשך השנה",
    "price": 1150,
    "currency": "ILS",
    "qty": 4,
    "url": "https://www.saad-robot.com/kraken",
    "sku": "WCP-0940",
    "vendor": "חנות ROBOT",
    "category": "מנועים",
    "status": "ordered",
    "team_scope": "frc",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "Kraken Powered by TalonFX X44",
    "level": "צריך להמשך השנה",
    "price": 1150,
    "currency": "ILS",
    "qty": 4,
    "url": "https://www.saad-robot.com/kraken",
    "sku": "WCP-0940",
    "vendor": "חנות ROBOT",
    "category": "מנועים",
    "status": "ordered",
    "team_scope": "frc",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "Pigeon 2.0",
    "level": "צריך להמשך השנה",
    "price": 1150,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.saad-robot.com/21-737785",
    "sku": "21-737785",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "ordered",
    "team_scope": "frc",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "Great Red Tacky Grease, 14.2 gram",
    "level": "צריך להמשך השנה",
    "price": 1.3,
    "currency": "ILS",
    "qty": 20,
    "url": "https://andymark.com/products/great-red-tacky-grease-14-2-gram",
    "sku": "am-2768",
    "vendor": "חנות ROBOT",
    "category": "תחזוקת סדנא כללית",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "Strafer® Chassis Kit (104mm GripForce™ Mecanum Wheels)",
    "level": "צריך להמשך השנה",
    "price": 2770,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.saad-robot.com/3209-0001-0007",
    "sku": "3209-0001-0007",
    "vendor": "חנות ROBOT",
    "category": "רובוט",
    "status": "ordered",
    "team_scope": "ftc",
    "notes": "צוות: Mechanic"
  },
  {
    "name": "Bore Inserts for 3D Printed Parts",
    "level": "צריך להמשך השנה",
    "price": 18,
    "currency": "ILS",
    "qty": 6,
    "url": "https://www.saad-robot.com/bore-inserts-for-3d-printed-parts",
    "sku": "am-5657",
    "vendor": "חנות ROBOT",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: שרטוט"
  },
  {
    "name": "1/2\" Hex Insert for 3D Printed Parts (5-pack)",
    "level": "צריך להמשך השנה",
    "price": 53,
    "currency": "ILS",
    "qty": 2,
    "url": "https://www.saad-robot.com/1-2-hex-insert-for-3d-printed-parts-5-pack",
    "sku": "217-8161",
    "vendor": "חנות ROBOT",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: שרטוט"
  },
  {
    "name": "FIRST Tech Challenge Perimeter Strap",
    "level": "צריך להמשך השנה",
    "price": 22,
    "currency": "USD",
    "qty": 2,
    "url": "https://andymark.com/products/first-tech-challenge-perimeter-strap",
    "sku": "am-2270a",
    "vendor": "חנות ROBOT",
    "category": "בניית מגרש",
    "status": "ordered",
    "team_scope": "ftc",
    "notes": "צוות: Mechanic · מותג: AndyMark · מחיר מקור: $22"
  },
  {
    "name": "FIRST Tech Challenge Panel Link",
    "level": "צריך להמשך השנה",
    "price": 3.4,
    "currency": "USD",
    "qty": 8,
    "url": "https://andymark.com/products/first-tech-challenge-panel-link",
    "sku": "am-2580a",
    "vendor": "חנות ROBOT",
    "category": "בניית מגרש",
    "status": "ordered",
    "team_scope": "ftc",
    "notes": "צוות: Mechanic · מותג: AndyMark · מחיר מקור: $3.4"
  },
  {
    "name": "FTC Perimeter Strap Hook",
    "level": "צריך להמשך השנה",
    "price": 8.4,
    "currency": "USD",
    "qty": 4,
    "url": "https://andymark.com/products/ftc-perimeter-strap-hook",
    "sku": "am-2583",
    "vendor": "חנות ROBOT",
    "category": "בניית מגרש",
    "status": "ordered",
    "team_scope": "ftc",
    "notes": "צוות: Mechanic · מותג: AndyMark · מחיר מקור: $8.4"
  },
  {
    "name": "FIRST Tech Challenge Field Panel Fastener 1-5/16 in. Quick Release Pin",
    "level": "צריך להמשך השנה",
    "price": 2.5,
    "currency": "USD",
    "qty": 8,
    "url": "https://andymark.com/products/first-tech-challenge-field-panel-fastener-1-5-16-in-quick-release-pin",
    "sku": "am-2579",
    "vendor": "חנות ROBOT",
    "category": "בניית מגרש",
    "status": "ordered",
    "team_scope": "ftc",
    "notes": "צוות: Mechanic · מותג: AndyMark · מחיר מקור: $2.5"
  },
  {
    "name": "6 Gauge Compression Lug Connector 1/4 Stud Hole BURNDY YAZV6CTC14FX",
    "level": "צריך להמשך השנה",
    "price": 3.6,
    "currency": "USD",
    "qty": 20,
    "url": "https://andymark.com/collections/connectors/products/6-gauge-compression-lug-connector-1-4-stud-hole-burndy-yazv6ctc14fx",
    "sku": "am-0805",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $3.6"
  },
  {
    "name": "Locking 2 Pin Connector Kits Female",
    "level": "צריך להמשך השנה",
    "price": 18.0,
    "currency": "USD",
    "qty": 1,
    "url": "https://andymark.com/collections/connectors/products/locking-2-pin-connector-kits?variant=44495447490732",
    "sku": "am-5505",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $18"
  },
  {
    "name": "Locking 2 Pin Connector Kits Male",
    "level": "צריך להמשך השנה",
    "price": 26.0,
    "currency": "USD",
    "qty": 1,
    "url": "https://andymark.com/collections/connectors/products/locking-2-pin-connector-kits?variant=44495447490732",
    "sku": "am-5504",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $26"
  },
  {
    "name": "Locking PWM Wire / Cable Making Kit",
    "level": "צריך להמשך השנה",
    "price": 50.0,
    "currency": "USD",
    "qty": 1,
    "url": "https://andymark.com/collections/connectors/products/locking-pwm-wire-cable-making-kit",
    "sku": "am-5483",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $50"
  },
  {
    "name": "Locking 4 Pin Connector Kits Female",
    "level": "צריך להמשך השנה",
    "price": 22.0,
    "currency": "USD",
    "qty": 1,
    "url": "https://andymark.com/collections/connectors/products/locking-4-pin-connector-kits?variant=44493468532908",
    "sku": "am-5508",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $22"
  },
  {
    "name": "Locking 4 Pin Connector Kits Male",
    "level": "צריך להמשך השנה",
    "price": 37.0,
    "currency": "USD",
    "qty": 1,
    "url": "https://andymark.com/collections/connectors/products/locking-4-pin-connector-kits?variant=44493468532908",
    "sku": "am-5507",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $37"
  },
  {
    "name": "שרשראות וחוליות חיבור half link #35",
    "level": "חידוש מלאי שוטף",
    "price": 4.0,
    "currency": "ILS",
    "qty": 10,
    "url": "https://www.saad-robot.com/Chain",
    "sku": "Saad-011",
    "vendor": "חנות ROBOT",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "Chain Turnbuckle #35",
    "level": "חידוש מלאי שוטף",
    "price": 60,
    "currency": "ILS",
    "qty": 2,
    "url": "https://www.saad-robot.com/chain-turnbuckle",
    "sku": "REV-21-3705",
    "vendor": "חנות ROBOT",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "Chain Turnbuckle #25",
    "level": "חידוש מלאי שוטף",
    "price": 60,
    "currency": "ILS",
    "qty": 2,
    "url": "https://www.saad-robot.com/chain-turnbuckle",
    "sku": "REV-21-2617",
    "vendor": "חנות ROBOT",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: Mechanic"
  },
  {
    "name": "קיט מחברי אנדרסון",
    "level": "חידוש מלאי שוטף",
    "price": 450,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.saad-robot.com/saad-018",
    "sku": "Saad-018",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "אום מתיחה M3",
    "level": "חידוש מלאי שוטף",
    "price": 12.1,
    "currency": "ILS",
    "qty": 60,
    "url": "https://he.aliexpress.com/item/1005006980061911.html",
    "sku": null,
    "vendor": "AliExpress",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "אום מתיחה M4",
    "level": "חידוש מלאי שוטף",
    "price": 13.34,
    "currency": "ILS",
    "qty": 60,
    "url": "https://he.aliexpress.com/item/1005006980061911.html",
    "sku": null,
    "vendor": "AliExpress",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "אום מתיחה M5",
    "level": "חידוש מלאי שוטף",
    "price": 13.26,
    "currency": "ILS",
    "qty": 60,
    "url": "https://he.aliexpress.com/item/1005006980061911.html",
    "sku": null,
    "vendor": "AliExpress",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "אום מתיחה M6",
    "level": "חידוש מלאי שוטף",
    "price": 17.58,
    "currency": "ILS",
    "qty": 60,
    "url": "https://he.aliexpress.com/item/1005006980061911.html",
    "sku": null,
    "vendor": "AliExpress",
    "category": "חומרי גלם",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "נגד 120 אוהם",
    "level": "חידוש מלאי שוטף",
    "price": 20.0,
    "currency": "ILS",
    "qty": 100,
    "url": "https://www.dgelect.co.il/product/נגד-120-אוהם-025w",
    "sku": null,
    "vendor": "DG אלקטרוניקה",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "איזולירבנד שחור",
    "level": "חידוש מלאי שוטף",
    "price": 31.4,
    "currency": "ILS",
    "qty": 10,
    "url": "https://he.aliexpress.com/item/1005009813160274.html",
    "sku": null,
    "vendor": "AliExpress",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "איזולירבנד אדום",
    "level": "חידוש מלאי שוטף",
    "price": null,
    "currency": "ILS",
    "qty": 2,
    "url": null,
    "sku": null,
    "vendor": "AliExpress",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "דאקטייפ כחול",
    "level": "חידוש מלאי שוטף",
    "price": null,
    "currency": "ILS",
    "qty": 4,
    "url": null,
    "sku": null,
    "vendor": "טכניק 2000",
    "category": "תחזוקת סדנא כללית",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "דאקטייפ אדום",
    "level": "חידוש מלאי שוטף",
    "price": null,
    "currency": "ILS",
    "qty": 2,
    "url": null,
    "sku": null,
    "vendor": "טכניק 2000",
    "category": "תחזוקת סדנא כללית",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "אזיקונים 100*3",
    "level": "חידוש מלאי שוטף",
    "price": null,
    "currency": "ILS",
    "qty": 2,
    "url": null,
    "sku": null,
    "vendor": "טכניק 2000",
    "category": "תחזוקת סדנא כללית",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "אזיקונים 240*4.8",
    "level": "חידוש מלאי שוטף",
    "price": null,
    "currency": "ILS",
    "qty": 2,
    "url": null,
    "sku": null,
    "vendor": "טכניק 2000",
    "category": "תחזוקת סדנא כללית",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "אזיקונים 400*4.8",
    "level": "חידוש מלאי שוטף",
    "price": null,
    "currency": "ILS",
    "qty": 2,
    "url": null,
    "sku": null,
    "vendor": "טכניק 2000",
    "category": "תחזוקת סדנא כללית",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "אזיקונים רב פעמיים 300*8 (50 יחידות)",
    "level": "חידוש מלאי שוטף",
    "price": 29.0,
    "currency": "ILS",
    "qty": 2,
    "url": "https://www.yhome.co.il/items/5840726_admin_version_1781677638",
    "sku": null,
    "vendor": "הבית שלך",
    "category": "תחזוקת סדנא כללית",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "כלי נעילה לאום מתיחה",
    "level": "תפעול סדנא כללי",
    "price": 83.22,
    "currency": "ILS",
    "qty": 1,
    "url": "https://he.aliexpress.com/item/1005005763937438.html",
    "sku": null,
    "vendor": "AliExpress",
    "category": "כלי עבודה ובטיחות",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "Dremel SpeedClic SC456B",
    "level": "תפעול סדנא כללי",
    "price": 130.0,
    "currency": "ILS",
    "qty": 1,
    "url": "https://polack.co.il/product/דיסק-חיתוך-38-ממ-למתכת-12-יח/",
    "sku": null,
    "vendor": "פולק כלי עבודה",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה · מותג: Dremel"
  },
  {
    "name": "ציר תפסנית ספיד קליק מהירה Dremel EZ SpeedClic SC402",
    "level": "תפעול סדנא כללי",
    "price": 69.0,
    "currency": "ILS",
    "qty": 2,
    "url": "https://ksp.co.il/web/item/183171",
    "sku": "186312",
    "vendor": "KSP",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה · מותג: Dremel"
  },
  {
    "name": "מקדח 3.2",
    "level": "תפעול סדנא כללי",
    "price": null,
    "currency": "ILS",
    "qty": 2,
    "url": null,
    "sku": null,
    "vendor": "AliExpress",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "מקדח 4.2",
    "level": "תפעול סדנא כללי",
    "price": null,
    "currency": "ILS",
    "qty": 2,
    "url": null,
    "sku": null,
    "vendor": "AliExpress",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "דיסק חיתוך לאלומיניום 14 אינץ׳",
    "level": "תפעול סדנא כללי",
    "price": 935.0,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.brandtools.co.il/ProductInfo.asp?ProdId=19059",
    "sku": null,
    "vendor": "בראנד אספקה טכנית",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "כרסם 3.175 2fl",
    "level": "תפעול סדנא כללי",
    "price": null,
    "currency": "ILS",
    "qty": 6,
    "url": null,
    "sku": null,
    "vendor": "AliExpress",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "גלגלת צינור אויר מיני 1/4\", 6 מטר ROHER",
    "level": "תפעול סדנא כללי",
    "price": 176.0,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.brandtools.co.il/ProductInfo.asp?ProdId=10466",
    "sku": null,
    "vendor": "בראנד אספקה טכנית",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "כונן חיצוני 2TB",
    "level": "תפעול סדנא כללי",
    "price": 399.0,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.bug.co.il/brand/wd/elements/2/tb",
    "sku": null,
    "vendor": "מחסני חשמל",
    "category": "תחזוקת סדנא כללית",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: אסף · קישורים נוספים: payngo.co.il/…/345997 · ksp.co.il/web/item/27000"
  },
  {
    "name": "פולידין",
    "level": "תפעול סדנא כללי",
    "price": null,
    "currency": "ILS",
    "qty": 1,
    "url": null,
    "sku": null,
    "vendor": "סופר פארם",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: אסף"
  },
  {
    "name": "Chain Tool 35#",
    "level": "תפעול סדנא כללי",
    "price": 129.0,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.saad-robot.com/217-5838",
    "sku": "217-5838",
    "vendor": "חנות ROBOT",
    "category": "כלי עבודה ובטיחות",
    "status": "ordered",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "ניטים 4*20",
    "level": "להשלים מידה/כמות",
    "price": null,
    "currency": "ILS",
    "qty": 1,
    "url": null,
    "sku": null,
    "vendor": null,
    "category": "חומרי גלם",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "ניטים 4*30",
    "level": "להשלים מידה/כמות",
    "price": null,
    "currency": "ILS",
    "qty": 1,
    "url": null,
    "sku": null,
    "vendor": null,
    "category": "חומרי גלם",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "ניטים 5*20",
    "level": "להשלים מידה/כמות",
    "price": null,
    "currency": "ILS",
    "qty": 1,
    "url": null,
    "sku": null,
    "vendor": null,
    "category": "חומרי גלם",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "ניטים 5*30",
    "level": "להשלים מידה/כמות",
    "price": null,
    "currency": "ILS",
    "qty": 1,
    "url": null,
    "sku": null,
    "vendor": null,
    "category": "חומרי גלם",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "אום לחץ 5M",
    "level": "להשלים מידה/כמות",
    "price": null,
    "currency": "ILS",
    "qty": 1,
    "url": null,
    "sku": null,
    "vendor": null,
    "category": "חומרי גלם",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "SystemCore",
    "level": "WIP",
    "price": null,
    "currency": "ILS",
    "qty": 2,
    "url": null,
    "sku": null,
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "frc",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "סט כלים למחרטה",
    "level": "WIP",
    "price": 78.0,
    "currency": "ILS",
    "qty": 1,
    "url": "https://he.aliexpress.com/item/33040037989.html",
    "sku": null,
    "vendor": "AliExpress",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה"
  },
  {
    "name": "CANrange",
    "level": "WIP",
    "price": 350.0,
    "currency": "ILS",
    "qty": 0,
    "url": "https://www.saad-robot.com/24-827871",
    "sku": "24-827871",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "frc",
    "notes": "צוות: תוכנה"
  },
  {
    "name": "AndyMark Hex Bore Encoder CAN Version",
    "level": "WIP",
    "price": 60,
    "currency": "USD",
    "qty": 0,
    "url": "https://andymark.com/products/hex-bore-encoder?variant=45166126104748",
    "sku": "am-5200_can",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "frc",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $60"
  },
  {
    "name": "Color and Proximity Sensor - AndyMark Standard Sensors",
    "level": "WIP",
    "price": 34,
    "currency": "USD",
    "qty": 0,
    "url": "https://andymark.com/products/color-and-proximity-sensor-andymark-standard-sensors?variant=45224853930156",
    "sku": "am-5683",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $34"
  },
  {
    "name": "Lidar Distance Sensor - AndyMark Standard Sensors",
    "level": "WIP",
    "price": 30,
    "currency": "USD",
    "qty": 0,
    "url": "https://andymark.com/products/lidar-distance-sensor-andymark-standard-sensors?variant=46151725088940",
    "sku": "am-5684",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $30"
  },
  {
    "name": "Magnetic Switch (Hall Effect Sensor) - AndyMark Standard Sensors",
    "level": "WIP",
    "price": 34,
    "currency": "USD",
    "qty": 0,
    "url": "https://andymark.com/products/magnetic-andymark-standard-sensors?variant=45328203350188",
    "sku": "am-5788",
    "vendor": "חנות ROBOT",
    "category": "אלקטרוניקה",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: תוכנה · מותג: AndyMark · מחיר מקור: $34"
  },
  {
    "name": "להב 14\" (355 מ״מ) לאלומיניום ופלדה דקה — Evolution",
    "level": "נחמד שיהיה אם אפשר",
    "price": 935.0,
    "currency": "ILS",
    "qty": 1,
    "url": "https://www.brandtools.co.il/ProductInfo.asp?ProdId=19059",
    "sku": "1075627",
    "vendor": "בראנד אספקה טכנית",
    "category": "כלי עבודה ובטיחות",
    "status": "approved",
    "team_scope": "both",
    "notes": "צוות: בנייה · מותג: Evolution"
  }
]'::jsonb;
begin
  ---------------------------------------------------------------- season ----
  -- Match an EXISTING 2027 season before creating one. The app names seasons
  -- like "Season 2027", so searching for the bare string '2027' would have
  -- quietly created a second, empty season next to the real one and imported
  -- all 62 items into the wrong place.
  select id into v_season from public.seasons
   where name = v_season_name or name ilike '%2027%'
   order by (name = v_season_name) desc, created_at
   limit 1;
  if v_season is null then
    insert into public.seasons (name, start_date, end_date, is_active)
    values (v_season_name, '2026-09-01', '2027-08-31', false)
    returning id into v_season;
    raise notice 'created season %', v_season_name;
  else
    raise notice 'using existing season (id %)', v_season;
  end if;

  ------------------------------------------------------------ categories ----
  for v_rec in select * from (values
    ('אלקטרוניקה'),
    ('בניית מגרש'),
    ('חומרי גלם'),
    ('כלי עבודה ובטיחות'),
    ('מנועים'),
    ('רובוט'),
    ('תחזוקת סדנא כללית')
  ) as x(name) loop
    if not exists (select 1 from public.categories c where c.name = v_rec.name) then
      insert into public.categories (name) values (v_rec.name);
      raise notice 'created category %', v_rec.name;
    end if;
  end loop;

  ------------------------------------------------------- priority levels ----
  for v_rec in select * from (values
    ('צריך דחוף', 1),
    ('צריך להמשך השנה', 2),
    ('חידוש מלאי שוטף', 3),
    ('נחמד שיהיה אם אפשר', 4),
    ('תפעול סדנא כללי', 5),
    ('WIP', 6),
    ('להשלים מידה/כמות', 7)
  ) as x(name, rank) loop
    if not exists (select 1 from public.priority_levels p where p.name = v_rec.name) then
      insert into public.priority_levels (name, rank) values (v_rec.name, v_rec.rank);
      raise notice 'created priority level %', v_rec.name;
    end if;
  end loop;

  --------------------------------------------------------------- vendors ----
  for v_rec in select * from (values
    ('AliExpress'),
    ('DG אלקטרוניקה'),
    ('KSP'),
    ('בראנד אספקה טכנית'),
    ('הבית שלך'),
    ('חנות ROBOT'),
    ('טכניק 2000'),
    ('מחסני חשמל'),
    ('סופר פארם'),
    ('פולק כלי עבודה')
  ) as x(name) loop
    if not exists (select 1 from public.vendors v where v.name = v_rec.name) then
      insert into public.vendors (name) values (v_rec.name);
      raise notice 'created vendor %', v_rec.name;
    end if;
  end loop;

  ----------------------------------------------------------------- items ----
  for v_item in select * from jsonb_array_elements(v_items) loop
    if exists (
      select 1 from public.shopping_items s
      where s.season_id = v_season and s.name = v_item->>'name'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select id into v_cat from public.categories      where name = v_item->>'category' limit 1;
    select id into v_lvl from public.priority_levels where name = v_item->>'level'    limit 1;

    v_price := case
      when v_item->>'price' is null then null
      when v_item->>'currency' = 'USD' then round((v_item->>'price')::numeric * v_usd_ils, 2)
      else (v_item->>'price')::numeric
    end;

    insert into public.shopping_items
      (season_id, name, url, sku, vendor, category_id, est_price, quantity,
       priority_level_id, status, notes, team_scope)
    values (
      v_season,
      v_item->>'name',
      nullif(v_item->>'url', ''),
      nullif(v_item->>'sku', ''),
      nullif(v_item->>'vendor', ''),
      v_cat,
      v_price,
      (v_item->>'qty')::int,
      v_lvl,
      (v_item->>'status')::shopping_status,
      nullif(v_item->>'notes', ''),
      (v_item->>'team_scope')::team_scope
    );
    v_added := v_added + 1;
  end loop;

  raise notice 'season %: % added, % skipped (already present)', v_season_name, v_added, v_skipped;
end $$;
