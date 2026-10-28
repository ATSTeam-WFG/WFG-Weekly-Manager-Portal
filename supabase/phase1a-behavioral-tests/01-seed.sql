-- NOT a migration — seeds one "real" manager and one "real" admin for the
-- four migrations' own embedded self-tests to find (they each look up an
-- existing active manager/admin, exactly like this project's own
-- 20260922_submits_weekly_report.sql self-test does).
INSERT INTO auth.users (id) VALUES
  ('a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002');

INSERT INTO public.profiles (id, full_name, email, role, is_active, submits_weekly_report) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Real Manager', 'real.manager@example.invalid', 'manager', true, true),
  ('a0000000-0000-0000-0000-000000000002', 'Real Admin', 'real.admin@example.invalid', 'admin', true, false);
