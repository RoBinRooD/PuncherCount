import type { ReactNode } from 'react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-panel p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-2">{label}</span>
      {children}
    </div>
  )
}

export function NumberRow(p: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const step = p.step ?? 1
  const set = (v: number) => p.onChange(Math.min(p.max, Math.max(p.min, v)))
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-ink-2">{p.label}</span>
      <div className="flex items-center gap-1">
        <button className="h-9 w-9 rounded-full bg-panel-2" onClick={() => set(p.value - step)}>
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          className="tabular w-16 rounded-lg bg-panel-2 py-1.5 text-center"
          value={p.value}
          onChange={(e) => set(Number(e.target.value) || p.min)}
        />
        <button className="h-9 w-9 rounded-full bg-panel-2" onClick={() => set(p.value + step)}>
          +
        </button>
      </div>
    </div>
  )
}

export function Segmented<T extends string>(p: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full bg-panel-2 p-1 text-sm">
      {p.options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => p.onChange(v)}
          className={`flex-1 rounded-full px-3 py-1.5 ${p.value === v ? 'bg-ink font-semibold text-black' : 'text-ink-2'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function Toggle(p: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-2">
        {p.label}
        {p.hint && <span className="block text-xs text-ink-3">{p.hint}</span>}
      </span>
      <input type="checkbox" className="h-5 w-5 accent-accent" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
    </label>
  )
}

export function Slider(p: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-sm text-ink-2">
        {p.label}
        <span className="tabular text-ink">{p.value}</span>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} className="accent-accent" />
      {p.hint && <span className="text-xs text-ink-3">{p.hint}</span>}
    </label>
  )
}
