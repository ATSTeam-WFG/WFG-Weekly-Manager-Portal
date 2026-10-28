-- NOT a migration — a throwaway stand-in schema for the pieces of the real
-- Supabase project the four Phase 1A migrations depend on but don't
-- define: the auth schema, auth.uid() (using the REAL mechanism confirmed
-- from this project's own 20260922_submits_weekly_report.sql self-test:
-- request.jwt.claims as a JSON blob, ->>'sub'), profiles/approved_employees
-- with their verified CHECK constraints and is_admin(), and a `reports`
-- table with RLS matching the verified-facts description supplied for this
-- task: INSERT/own-row-UPDATE check active profile + ownership only (no
-- role gate — the gap Phase 1A closes); admin UPDATE is a separate policy.
-- Never run against the real project — see run.sh, which only ever targets
-- a disposable local Docker Postgres container.

-- Roles standing in for PostgREST's own — created first since policies
-- below reference them.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  full_name text,
  email text,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  submits_weekly_report boolean NOT NULL DEFAULT false,
  leadership_report_authorized boolean NOT NULL DEFAULT false,
  CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'manager'))
);

CREATE TABLE public.approved_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  email text,
  portal_role text,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT approved_employees_portal_role_check CHECK (portal_role IN ('admin', 'manager'))
);

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
  )
$$;

CREATE TABLE public.reports (
  manager_id uuid NOT NULL REFERENCES public.profiles(id),
  week_start_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submission_source text CHECK (
    (status = 'draft' AND submission_source IS NULL)
    OR (status = 'submitted' AND submission_source IN ('manual', 'automatic'))
  ),
  what_matters_now text,
  PRIMARY KEY (manager_id, week_start_date)
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Verified-facts baseline: ownership + active profile only, no role gate —
-- this is the exact gap 20261027140100_reports_restrict_to_manager_admin.sql
-- closes additively, via a RESTRICTIVE policy, never by replacing these.
CREATE POLICY reports_insert_own
  ON public.reports FOR INSERT TO authenticated
  WITH CHECK (
    manager_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active = true)
  );

CREATE POLICY reports_update_own
  ON public.reports FOR UPDATE TO authenticated
  USING (
    manager_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active = true)
  )
  WITH CHECK (
    manager_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active = true)
  );

CREATE POLICY reports_update_admin
  ON public.reports FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY reports_select_own_or_admin
  ON public.reports FOR SELECT TO authenticated
  USING (manager_id = auth.uid() OR public.is_admin());

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
