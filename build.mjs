import { build, context } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

const watch = process.argv.includes('--watch')

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })
cpSync('public', 'dist', { recursive: true })
cpSync('src/dashboard/dashboard.html', 'dist/dashboard.html')
cpSync('src/dashboard/dashboard.css', 'dist/dashboard.css')

const options = {
  entryPoints: {
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
    dashboard: 'src/dashboard/index.ts',
  },
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
} else {
  await build(options)
}
