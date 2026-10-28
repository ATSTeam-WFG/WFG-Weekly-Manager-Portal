-- NOT a migration — creates one synthetic rep + two synthetic managers for
-- run.sh to fire two CONCURRENT assign_sales_rep calls against (from two
-- separate background psql processes — a true overlapping-transaction
-- race, which a single serial DO $$ block cannot produce by itself).
INSERT INTO auth.users (id) VALUES
  ('c0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-00000000000b'),
  ('c0000000-0000-0000-0000-00000000000c')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Race Test Rep', 'phase1a-race-rep@example.invalid', 'sales_rep', true),
  ('c0000000-0000-0000-0000-00000000000b', 'Race Test Manager 1', 'phase1a-race-mgr1@example.invalid', 'manager', true),
  ('c0000000-0000-0000-0000-00000000000c', 'Race Test Manager 2', 'phase1a-race-mgr2@example.invalid', 'manager', true)
ON CONFLICT (id) DO NOTHING;
