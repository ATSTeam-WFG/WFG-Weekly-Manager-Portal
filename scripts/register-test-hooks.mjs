// Registers test-ts-extension-hook.mjs via the current, non-deprecated
// node:module API. See that file for why this hook exists. Load this with
// `node --import ./scripts/register-test-hooks.mjs --test ...` (already
// wired into package.json's "test" script) rather than the deprecated
// `--experimental-loader` flag.
import { register } from 'node:module'

register('./test-ts-extension-hook.mjs', import.meta.url)
