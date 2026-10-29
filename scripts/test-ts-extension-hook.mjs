// Node module-customization resolve hook, used ONLY when running this
// project's test suite directly via `node --test` (see package.json's
// "test" script). Not used by the app itself in any way — Vite (dev) and
// esbuild/Rollup (production build) already resolve these imports
// correctly on their own.
//
// Root cause this works around: tsconfig.app.json/tsconfig.node.json both
// set moduleResolution:"bundler" with allowImportingTsExtensions:true,
// which is why this project's own .ts source files correctly write a
// `.js` extension in relative imports of sibling .ts files (e.g.
// src/utils/week.ts importing `./easternTime.js`) — a bundler is expected
// to rewrite that extension at build/dev time, and Vite does. Node's
// native TypeScript type-stripping (the mechanism `node --test` uses to
// run .ts files directly, with no build step) only strips type syntax; it
// does not perform this extension rewrite, so a bare `.js` specifier that
// has no matching .js file on disk fails to resolve with
// ERR_MODULE_NOT_FOUND even though the intended .ts file exists right
// next to it. This hook retries exactly that one substitution, and only
// as a fallback after the normal resolution has already failed — every
// other import continues to resolve exactly as Node would without this
// hook.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && isRelative && specifier.endsWith('.js')) {
      return nextResolve(specifier.slice(0, -'.js'.length) + '.ts', context)
    }
    throw err
  }
}
