import fs from 'node:fs'
import path from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

describe('production build tree-shaking', () => {
  it('verifies a default build contains no demo code', async () => {
    const outDir = path.resolve('dist/test-default-build')
    delete process.env.VITE_DEMO

    await build({
      root: '.',
      base: '/',
      configFile: path.resolve('vite.config.ts'),
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
      },
    })

    const jsFiles = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js'))
    // Default build should emit only one main bundle, no dynamic demo chunk
    expect(jsFiles.length).toBe(1)

    const mainBundle = fs.readFileSync(path.join(outDir, 'assets', jsFiles[0]!), 'utf-8')
    expect(mainBundle).not.toContain('mail_automation_demo_db')
    expect(mainBundle).not.toContain('createSeedStore')
    expect(mainBundle).not.toContain('sub_trial001')

    fs.rmSync(outDir, { recursive: true, force: true })
  }, 30_000)

  it('emits the demo chunk when built with VITE_DEMO=1', async () => {
    const outDir = path.resolve('dist/test-demo-build')
    process.env.VITE_DEMO = '1'

    try {
      await build({
        root: '.',
        base: '/',
        configFile: path.resolve('vite.config.ts'),
        build: {
          outDir,
          emptyOutDir: true,
          minify: false,
        },
      })

      const jsFiles = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js'))
      expect(jsFiles.length).toBeGreaterThan(1)

      const combined = jsFiles.map((f) => fs.readFileSync(path.join(outDir, 'assets', f), 'utf-8')).join('\n')
      expect(combined).toContain('mail_automation_demo_db')
    } finally {
      delete process.env.VITE_DEMO
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  }, 30_000)
})
