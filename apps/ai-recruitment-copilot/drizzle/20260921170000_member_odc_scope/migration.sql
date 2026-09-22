-- db push may have created these objects without recording this migration.
-- Preserve matching objects and data; fail explicitly on incompatible definitions.
DO $migration$
DECLARE
  target record;
  check_definition text;
  check_validated boolean;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('member', 'member_odc_scope_mode_check'),
      ('platform_pre_registration', 'pre_registration_odc_scope_mode_check')
    ) AS targets(table_name, constraint_name)
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS odc_scope_mode text DEFAULT %L NOT NULL',
      target.table_name, 'selected'
    );

    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute attribute
      JOIN pg_attrdef def ON def.adrelid = attribute.attrelid AND def.adnum = attribute.attnum
      WHERE attribute.attrelid = to_regclass(target.table_name)
        AND attribute.attname = 'odc_scope_mode'
        AND NOT attribute.attisdropped
        AND attribute.atttypid = 'text'::regtype
        AND attribute.attnotnull
        AND attribute.attgenerated = ''
        AND pg_get_expr(def.adbin, def.adrelid) = '''selected''::text'
    ) THEN
      RAISE EXCEPTION 'Unexpected definition for %.odc_scope_mode; expected text NOT NULL DEFAULT selected', target.table_name;
    END IF;

    SELECT pg_get_constraintdef(oid), convalidated
      INTO check_definition, check_validated
      FROM pg_constraint
      WHERE conrelid = to_regclass(target.table_name) AND conname = target.constraint_name;

    IF FOUND THEN
      -- PostgreSQL normalizes the schema's IN expression to this ANY expression.
      IF check_definition IS DISTINCT FROM 'CHECK ((odc_scope_mode = ANY (ARRAY[''all''::text, ''selected''::text])))'
         OR NOT check_validated THEN
        RAISE EXCEPTION 'Unexpected definition for %; expected validated CHECK (odc_scope_mode IN (all, selected))', target.constraint_name;
      END IF;
    ELSE
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (odc_scope_mode IN (%L, %L))',
        target.table_name, target.constraint_name, 'all', 'selected'
      );
    END IF;
  END LOOP;
END
$migration$;
