-- ═══════════════════════════════════════════════════════════════════
-- Endurecimiento para Supabase.
-- Supabase publica el esquema public por su Data API con los roles anon y authenticated, y por
-- defecto les da permisos sobre las tablas que crea postgres. El ERP no usa esa API: a los datos
-- solo accede la API propia con el rol erp_app (y RLS por empresa). Se quitan esos permisos, en
-- especial sobre las tablas sin RLS (users, sessions, company_users, permissions).
-- Fuera de Supabase esos roles no existen y esta migración no hace nada.
-- ═══════════════════════════════════════════════════════════════════
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- Tablas, secuencias y funciones que creen las próximas migraciones.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
