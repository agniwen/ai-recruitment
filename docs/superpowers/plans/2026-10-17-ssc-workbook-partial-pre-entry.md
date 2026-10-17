# SSC workbook import and partial pre-entry

The user explicitly requested importing 公司对应的SSC人员.xlsx and approved keeping incomplete rows with blank SSC details. The workbook has 66 data rows. Three notes name additional SSCs, giving 69 relationships across 63 centers. Two rows for 子亦 lack email; SZ公司 has no SSC yet. Preserve those blanks and original notes. Do not invent contact details or overwrite unrelated records.

Only centerName remains required. sscName, email, telegram, demandOwner and notes accept empty strings; email must be valid when nonempty and is trimmed/lowercased. Retain all existing length limits and administrator/workspace isolation. UI labels these fields optional, displays missing contact details as 待补充, and stores only empty strings.

Uniqueness: workspace + lower(trim(centerName)) + first available normalized identity: email (email: prefix), otherwise TG (telegram:), otherwise name (name:), otherwise unassigned. New migration drops only obsolete name/email nonempty checks and replaces the old unique index; existing row fields and timestamps must not change. Center nonempty check remains.

Tasks:
- Backend: write and observe failing HTTP/database and migration tests; implement schema, identity index, DAO duplicate mapping and additive migration. Test partial entries, multiple unnamed-email SSCs, normalization, concurrent duplicate protection, identity updates, original-data preservation.
- UI: test then implement center-only save, optional labels, blank edit backfill and pending placeholders; retain six-field API.
- Integration: isolated test DB migration, formatter/lint/typecheck, backend/UI regression and independent review. Back up active DB, deploy tested commit and verify all existing relationships unchanged. Import remaining three rows through authenticated app API; compare all six fields of all 69 expected rows. Verify actual UI and preserve all existing candidate/Offer/member data.

Performance investigation is read-only in this task: current server CPU idle about 79-83%, available RAM about10GB. Server loopback /api/ready 16-25ms, client HTTPS 1.7-2.6s (busy sample15s), current web runs Vite dev. Do not switch auth/runtime configuration without a separate implementation scope.
