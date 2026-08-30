import { useEffect, useRef, useState } from 'react'
import { MERGE_VARIABLES, type StepDto, type TemplateDto } from '@shared/types'
import { api } from '../lib/api'
import { useApp } from '../App'
import { Badge, Button, Field, Input, Textarea, Toggle } from './ui'
import { IconCode, IconEye, IconWarn } from './Icons'

export interface EditorValue {
  name?: string
  subject: string
  preheader: string
  html: string
  text: string
}

/**
 * Shared content editor for templates and campaign steps: merge-tag aware
 * inputs, live personalisation preview, variable audit and a test send.
 */
export function ContentEditor({
  value,
  onChange,
  onSave,
  saveLabel = 'Save',
  saving = false,
  testTarget,
  sample = {},
  onSampleChange,
  compact = false,
  hideText = true,
}: {
  value: EditorValue
  onChange: (patch: Partial<EditorValue>) => void
  onSave?: () => void
  saveLabel?: string
  saving?: boolean
  testTarget?: { kind: 'template'; id: number } | { kind: 'campaign'; id: number; stepId?: number }
  sample?: Record<string, string>
  onSampleChange?: (sample: Record<string, string>) => void
  compact?: boolean
  hideText?: boolean
}) {
  const { toast } = useApp()
  const [mode, setMode] = useState<'edit' | 'preview'>(compact ? 'edit' : 'edit')
  const [preview, setPreview] = useState<{ subject: string; preheader: string; html: string; text: string; issues: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const htmlRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLIFrameElement>(null)
  const [showText, setShowText] = useState(!hideText)

  const runPreview = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.templates.preview({ subject: value.subject, preheader: value.preheader, html: value.html, text: value.text, sample })
      setPreview(result)
      setMode('preview')
    } catch (error) {
      toast('error', 'Preview failed', (error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (mode !== 'preview' || !preview || !previewRef.current) return
    const doc = previewRef.current.contentDocument
    if (!doc) return
    doc.open()
    doc.write(preview.html || '<p>nothing to preview</p>')
    doc.close()
  }, [mode, preview])

  const insert = (token: string): void => {
    const area = htmlRef.current
    const snippet = `{{ ${token} }}`
    if (!area) {
      onChange({ html: `${value.html}${snippet}` })
      return
    }
    const start = area.selectionStart ?? value.html.length
    const end = area.selectionEnd ?? start
    const next = `${value.html.slice(0, start)}${snippet}${value.html.slice(end)}`
    onChange({ html: next })
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }

  return (
    <div className="space-y-3.5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <Field label="Subject line" required hint={`${value.subject.length}/300 · personalisation works here too`}>
          <Input value={value.subject} onChange={(event) => onChange({ subject: event.target.value })} placeholder="Welcome aboard, {{ first_name | friend }}" />
        </Field>
        <Field label="Preheader" hint="The preview text shown next to the subject">
          <Input value={value.preheader} onChange={(event) => onChange({ preheader: event.target.value })} placeholder="Your 3-step start" />
        </Field>
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Insert variable</span>
          {MERGE_VARIABLES.map((variable) => (
            <button
              key={variable.token}
              type="button"
              onClick={() => insert(variable.token)}
              title={variable.example ? `e.g. ${variable.example}` : variable.label}
              className="chip hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              <span className="font-mono text-[11px]">{`{{${variable.token}}}`}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <button type="button" onClick={() => setMode('edit')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium ${mode === 'edit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            <IconCode size={14} /> HTML
          </button>
          <button type="button" onClick={() => (preview ? setMode('preview') : void runPreview())} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium ${mode === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            <IconEye size={14} /> Preview
          </button>
        </div>
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void runPreview()}>
          Render with sample
        </Button>
        {onSampleChange ? (
          <div className="flex items-center gap-1.5">
            <Input
              className="!w-40 !py-1 text-[12px]"
              value={sample.name ?? ''}
              placeholder="sample name"
              onChange={(event) => onSampleChange({ ...sample, name: event.target.value })}
            />
            <Input
              className="!w-40 !py-1 text-[12px]"
              value={sample.company ?? ''}
              placeholder="sample company"
              onChange={(event) => onSampleChange({ ...sample, company: event.target.value })}
            />
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {!hideText ? <Toggle checked={showText} onChange={setShowText} label="plain text" /> : null}
          {onSave ? (
            <Button size="sm" variant="primary" loading={saving} onClick={onSave}>
              {saveLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {mode === 'edit' ? (
        <div className="space-y-3">
          <Field label="Email body (HTML)" hint="Keep it table-based and inline-styled for the best client support">
            <Textarea ref={htmlRef} rows={compact ? 10 : 16} value={value.html} onChange={(event) => onChange({ html: event.target.value })} placeholder="<h2>Hi {{ first_name }},</h2>" />
          </Field>
          {showText ? (
            <Field label="Plain-text alternative" hint="Left empty it is generated from the HTML">
              <Textarea rows={6} value={value.text} onChange={(event) => onChange({ text: event.target.value })} placeholder="Plain text version…" />
            </Field>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {preview?.issues.length ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              <IconWarn size={14} className="mt-0.5" />
              <span>
                Unknown variable{preview.issues.length === 1 ? '' : 's'}: <span className="font-mono">{preview.issues.join(', ')}</span>. Those will render as their fallback (or nothing).
              </span>
            </div>
          ) : null}
          {preview ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[13.5px] font-semibold text-slate-900">{preview.subject || '(no subject)'}</p>
              {preview.preheader ? <p className="mt-0.5 text-[12px] text-slate-500">{preview.preheader}</p> : null}
              <iframe ref={previewRef} title="Rendered email preview" className="mt-2.5 h-[420px] w-full rounded-md border border-slate-100 bg-slate-50" sandbox="allow-same-origin" />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500">Render a preview to see the personalisation.</div>
          )}
          {preview?.text ? (
            <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[12.5px] text-slate-600">
              <summary className="cursor-pointer font-medium">Plain text alternative</summary>
              <pre className="scroll-thin mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[11.5px]">{preview.text}</pre>
            </details>
          ) : null}
        </div>
      )}

      {testTarget ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
          <Field label="Send a test copy" className="min-w-[220px] flex-1">
            <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="you@example.com" />
          </Field>
          <Button
            size="sm"
            loading={testing}
            disabled={!testEmail.includes('@')}
            onClick={async () => {
              setTesting(true)
              try {
                const result =
                  testTarget.kind === 'template'
                    ? await api.templates.test(testTarget.id, testEmail)
                    : await api.campaigns.sendTest(testTarget.id, testEmail, testTarget.stepId)
                toast('success', 'Test sent', `Delivered via ${result.transport}${'mailboxId' in result && result.mailboxId ? ' — open the Inbox to read it' : ''}.`)
              } catch (error) {
                toast('error', 'Test failed', (error as Error).message)
              } finally {
                setTesting(false)
              }
            }}
          >
            Test send
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export const emptyStep = (position = 0): StepDto => ({
  id: 0,
  campaignId: 0,
  position,
  name: `Email ${position + 1}`,
  templateId: null,
  subject: '',
  preheader: '',
  html: '',
  text: '',
  delayMinutes: 0,
  skipIfOpened: false,
  skipIfClicked: false,
})

export const fromTemplate = (template: TemplateDto, position = 0): EditorValue => ({
  name: template.name,
  subject: template.subject,
  preheader: template.preheader,
  html: template.html,
  text: template.text,
})

export const delayUnits = [
  { label: 'minutes', factor: 1 },
  { label: 'hours', factor: 60 },
  { label: 'days', factor: 1440 },
] as const

export function DelayPicker({ minutes, onChange }: { minutes: number; onChange: (next: number) => void }) {
  const unit = minutes % 1440 === 0 && minutes > 0 ? 'days' : minutes % 60 === 0 && minutes > 0 ? 'hours' : 'minutes'
  const factor = delayUnits.find((candidate) => candidate.label === unit)?.factor ?? 1
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        className="!w-20"
        value={Math.round(minutes / factor)}
        onChange={(event) => onChange(Math.max(0, Math.round(Number(event.target.value || 0)) * factor))}
      />
      <select
        className="field !w-auto !py-2 text-[12.5px]"
        value={unit}
        onChange={(event) => {
          const next = delayUnits.find((candidate) => candidate.label === event.target.value)?.factor ?? 1
          onChange(Math.round((minutes / factor) * next))
        }}
      >
        {delayUnits.map((candidate) => (
          <option key={candidate.label} value={candidate.label}>
            {candidate.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export const DelayBadge = ({ minutes }: { minutes: number }) =>
  minutes <= 0 ? <Badge tone="emerald">send now</Badge> : <Badge tone="violet">wait {minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`}</Badge>
