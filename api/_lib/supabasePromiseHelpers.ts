// A supabase-js query/.rpc(...) call returns a PostgrestFilterBuilder — a
// THENABLE (it implements .then(), so `await` works) but it does NOT
// implement .catch()/.finally() as real methods. Chaining `.catch(...)`
// directly on one (e.g. `auth.supabase.rpc(...).catch(() => {})`) throws a
// synchronous TypeError — "... .catch is not a function" — before the
// request is ever sent. This crashed a real error-recording attempt in
// production use (2026-10-12, api/video/presenter/authorize-generation.ts):
// the ORIGINAL provider error was replaced by this unrelated TypeError, the
// intended 'failed'/'uncertain' write never ran, and the affected clip-job
// row was left stuck at 'pending' instead.
//
// recordBestEffort is the one safe way to best-effort-record an outcome
// without risking that: a real try/catch around a real `await`, never a
// chained method that may not exist on the builder. Deliberately kept in
// its own file with zero imports (not even @supabase/supabase-js) so it can
// be executed and tested directly under plain `node --test`, unlike the
// route file that uses it — see supabasePromiseHelpers.test.ts for tests
// that actually reproduce the original crash against a fake thenable
// shaped exactly like the real one (has .then, lacks .catch/.finally).
//
// The caller is always already inside its own catch block handling the
// ORIGINAL error (which it re-throws immediately after calling this) — a
// failure here must never replace or mask that original error, so nothing
// is re-thrown or returned.
export async function recordBestEffort(promiseLike: PromiseLike<unknown>): Promise<void> {
  try {
    await promiseLike
  } catch {
    // Best-effort only, by design — see this function's own header.
  }
}
