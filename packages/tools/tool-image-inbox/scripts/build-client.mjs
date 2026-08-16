/**
 * Build the client bundle in the format the DSH client module loader expects:
 * a classic script that self-registers through
 * `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`.
 *
 * `react` and every `@deepseek-ai/*` dependency except schemastery stay
 * external (resolved by the factory's `require` at runtime); schemastery is
 * INLINED because the typert Remote contribution carries live schemastery
 * schema objects.
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['src/client.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  sourcemap: false,
  logLevel: 'info',
  external: ['react', 'react/*', ...externalDeepseek()],
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      '  id: "@dsh-collaboration/tool-image-inbox",',
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
      '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    ].join('\n'),
  },
  footer: {
    js: '    return module.exports;\n  }\n});\n',
  },
})

function externalDeepseek() {
  // Everything under @deepseek-ai except schemastery (inlined on purpose).
  // esbuild externals allow one trailing wildcard; these cover the packages
  // the client MAY import — currently none beyond react + schemastery.
  return ['@deepseek-ai/cordis', '@deepseek-ai/cordis*', '@deepseek-ai/dsh-*', '@deepseek-ai/typert-*']
}
