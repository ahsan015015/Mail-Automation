/**
 * `node:sqlite` is still flagged experimental in Node 22 and prints a warning on
 * first use. We pin the behaviour we rely on (prepared statements, RETURNING,
 * JSON1) and silence only that one message. Import this module *before*
 * `node:sqlite` so the patch is installed first (ESM evaluates in import order).
 */
type EmitWarning = (warning: string | Error, ...args: unknown[]) => void

const original = process.emitWarning as EmitWarning

if (!(original as unknown as { __maSqlitePatch?: boolean }).__maSqlitePatch) {
  const patched = ((warning: string | Error, ...args: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning?.message
    const type = (args[0] as { type?: string } | undefined)?.type
    if (type === 'ExperimentalWarning' && /SQLite/i.test(text || '')) return
    return original.call(process, warning, ...args)
  }) as EmitWarning & { __maSqlitePatch?: boolean }

  patched.__maSqlitePatch = true
  process.emitWarning = patched as typeof process.emitWarning
}

export {}
