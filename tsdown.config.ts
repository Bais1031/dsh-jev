/** Build the browser half as a DSH module-loader factory. */
import type { UserConfig } from 'tsdown'

const PACKAGE_NAME = 'dsh-jev'
const EXTERNALS = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
])

const config: UserConfig = {
  name: `${PACKAGE_NAME}/client`,
  entry: { client: 'src/browser/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: specifier => EXTERNALS.has(specifier),
    alwaysBundle: specifier => !EXTERNALS.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client-plugin.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default config
