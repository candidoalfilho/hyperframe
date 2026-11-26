import { useState, type ReactNode } from 'react'
import type {
  BeamDetailSpan,
  BeamRebarCheck,
  ColumnRebarCheck,
  RebarCheckItem,
  RebarOverride,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { NumberField, OptionalNumberField } from '../panels/NumberField'
import { IconChevronDown } from '../components/Icons'

/**
 * Editor de armaduras (issue #12) — vigas e pilares. Os ajustes entram no
 * arquivo do projeto e refazem o detalhamento na hora, sem invalidar a
 * análise. Cada vão/pilar mostra as verificações refeitas com a armadura
 * adotada (não é só comparação de áreas).
 */

const BAR_MM = [6.3, 8, 10, 12.5, 16, 20, 25]
const COLUMN_BAR_MM = [10, 12.5, 16, 20, 25]
const STIRRUP_MM = [5, 6.3, 8, 10]

const muted = { fontSize: 11 } as const
const cell = { display: 'inline-flex', alignItems: 'center', gap: 4 } as const

function PhiSelect({
  value,
  options,
  label,
  disabled,
  onChange,
}: {
  value: number
  options: number[]
  label: string
  disabled?: boolean
  onChange: (phi: number) => void
}) {
  return (
    <select
      className="select"
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{ height: 22, fontSize: 11 }}
      value={String(Math.round(value * 10000))}
      onChange={(e) => onChange(Number(e.target.value) / 10000)}
    >
      {options.map((mm) => (
        <option key={mm} value={String(Math.round(mm * 10))}>
          φ {String(mm).replace('.', ',')}
        </option>
      ))}
    </select>
  )
}

const STATUS_CHIP: Record<'ok' | 'atencao' | 'falha', [string, string]> = {
  ok: ['chip ok', 'atende'],
  atencao: ['chip warn', 'atenção'],
  falha: ['chip err', 'NÃO ATENDE'],
}

/** verificações com a armadura adotada: as que não atendem primeiro */
function CheckList({ items, testId }: { items: RebarCheckItem[]; testId?: string }) {
  const [all, setAll] = useState(false)
  const bad = items.filter((i) => !i.ok)
  const shown = all ? items : bad
  return (
    <div data-testid={testId} style={{ margin: '2px 0 6px 50px' }}>
      {shown.map((i) => (
        <div key={i.id} style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: 1.5 }}>
          <span
            style={{
              color: i.ok ? 'var(--ok)' : (i.severity ?? 'falha') === 'falha' ? 'var(--err)' : 'var(--warn)',
              flex: 'none',
              width: 10,
            }}
          >
            {i.ok ? '✓' : '✗'}
          </span>
          <span>
            <b>{i.label}</b> — <span className="muted">{i.detail}</span>
          </span>
        </div>
      ))}
      <button
        className="btn btn-ghost"
        style={{ height: 20, fontSize: 10.5, padding: '0 6px', marginTop: 2 }}
        onClick={() => setAll(!all)}
      >
        {all ? 'mostrar só o que não atende' : `ver as ${items.length} verificações`}
      </button>
    </div>
  )
}

function StatusChip({ status, manual }: { status: 'ok' | 'atencao' | 'falha'; manual: boolean }) {
  const [cls, txt] = STATUS_CHIP[status]
  return (
    <span className={cls} title="Verificações refeitas com a armadura adotada">
      {manual ? 'editada · ' : ''}
      {txt}
    </span>
  )
}

/** alterna entre a armadura editada e a solução do programa, sem apagar os ajustes */
function SolutionToggle() {
  const off = useStore((s) => !!s.project.rebarOverridesOff)
  const setOff = useStore((s) => s.setRebarOverridesOff)
  const any = useStore(
    (s) => (s.project.rebarOverrides?.length ?? 0) + (s.project.columnRebarOverrides?.length ?? 0) > 0,
  )
  if (!any) return null
  return (
    <label
      style={{ ...cell, fontSize: 11, cursor: 'pointer' }}
      title="Mostra o detalhamento automático sem apagar os ajustes; desmarque para voltar à armadura editada"
      onClick={(e) => e.stopPropagation()}
    >
      <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} />
      ver a solução do programa
    </label>
  )
}

function Frame({
  title,
  right,
  children,
  testId,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  testId: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      data-testid={testId}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '6px 10px',
        marginBottom: 8,
        flex: 'none',
        maxHeight: open ? '46%' : undefined,
        overflowY: open ? 'auto' : undefined,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(!open)}
      >
        <IconChevronDown
          size={12}
          style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 0.15s' }}
        />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>{right}</span>
      </div>
      {open && children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// vigas
// ---------------------------------------------------------------------------

type Slot = 'positive' | 'negLeft' | 'negRight'

function BarSlot({
  label,
  beamId,
  spanIndex,
  slot,
  bar,
  programa,
  disabled,
}: {
  label: string
  beamId: string
  spanIndex: number
  slot: Slot
  bar: NonNullable<BeamDetailSpan['negLeft']> | BeamDetailSpan['positive']
  /** arranjo e área do dimensionamento automático, para comparar */
  programa: string
  disabled: boolean
}) {
  const set = useStore((s) => s.setRebarOverride)
  const ov = useStore((s) =>
    s.project.rebarOverrides?.find((o) => o.beamId === beamId && o.spanIndex === spanIndex && o.slot === slot),
  )
  const n = bar.n + ('cut' in bar ? (bar.cut?.n ?? 0) : 0)
  const key = { beamId, spanIndex, slot }
  const manualLen = ov?.length !== undefined
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '2px 0' }}>
      <span className="muted" style={{ ...muted, width: 62 }}>
        {label}
      </span>
      <span style={cell}>
        <NumberField
          value={n}
          digits={0}
          min={1}
          max={24}
          disabled={disabled}
          title="Quantidade de barras"
          style={{ width: 38 }}
          onCommit={(v) => set({ ...key, n: Math.max(1, Math.round(v)), phi: bar.phi })}
        />
        <PhiSelect
          value={bar.phi}
          options={BAR_MM}
          label={`Bitola — ${label}`}
          disabled={disabled}
          onChange={(p) => set({ ...key, n, phi: p })}
        />
      </span>
      <span style={cell} title="Comprimento de corte da barra (desenvolvido, com ganchos). Vazio = calculado pelo programa">
        <span className="muted" style={muted}>
          C
        </span>
        <OptionalNumberField
          value={manualLen ? Math.round(bar.length * 100) : undefined}
          digits={0}
          min={20}
          max={3000}
          disabled={disabled}
          placeholder={String(Math.round((bar.lengthAuto ?? bar.length) * 100))}
          style={{ width: 52 }}
          onCommit={(v) => set({ ...key, length: v === undefined ? undefined : v / 100 })}
        />
        <span className="muted" style={muted}>
          cm
        </span>
      </span>
      {slot !== 'positive' && (
        <label style={{ ...cell, fontSize: 11, cursor: 'pointer' }} title="A barra segue pelo vão inteiro e ancora além do outro apoio (continuidade)">
          <input
            type="checkbox"
            disabled={disabled}
            checked={!!ov?.through}
            onChange={(e) => set({ ...key, through: e.target.checked ? true : undefined })}
          />
          até o outro apoio
        </label>
      )}
      <span className="faint" style={{ fontSize: 10.5 }}>
        programa: {programa}
      </span>
    </div>
  )
}

function StirrupRow({
  beamId,
  span,
  programa,
  disabled,
}: {
  beamId: string
  span: BeamDetailSpan
  programa: string
  disabled: boolean
}) {
  const set = useStore((s) => s.setRebarOverride)
  const ov = useStore((s) =>
    s.project.rebarOverrides?.find(
      (o) => o.beamId === beamId && o.spanIndex === span.spanIndex && o.slot === 'stirrup',
    ),
  )
  const key = { beamId, spanIndex: span.spanIndex, slot: 'stirrup' as const }
  const st = span.stirrup
  const zone = (side: 'left' | 'right', label: string) => {
    const z = ov?.[side]
    const upd = (patch: Partial<{ length: number; spacing: number }>) => {
      const next = { length: z?.length ?? 0, spacing: z?.spacing ?? st.spacing, ...patch }
      set({ ...key, [side]: next.length > 0.01 ? next : undefined } as RebarOverride)
    }
    return (
      <span style={cell} title={`Trecho junto ao apoio ${label}, com passo próprio. Comprimento vazio = sem trecho`}>
        <span className="muted" style={muted}>
          apoio {label}:
        </span>
        <OptionalNumberField
          value={z ? Math.round(z.length * 100) : undefined}
          digits={0}
          min={10}
          max={Math.round(span.length * 100)}
          disabled={disabled}
          placeholder="—"
          style={{ width: 44 }}
          onCommit={(v) => upd({ length: v === undefined ? 0 : v / 100 })}
        />
        <span className="muted" style={muted}>
          cm c/
        </span>
        <NumberField
          value={Math.round((z?.spacing ?? st.spacing) * 100)}
          digits={0}
          min={5}
          max={30}
          disabled={disabled || !z}
          style={{ width: 38 }}
          onCommit={(v) => upd({ spacing: v / 100 })}
        />
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '2px 0' }}>
      <span className="muted" style={{ ...muted, width: 62 }}>
        estribo
      </span>
      <span style={cell}>
        <PhiSelect value={st.phi} options={STIRRUP_MM} label="Bitola do estribo" disabled={disabled} onChange={(p) => set({ ...key, phi: p })} />
        <select
          className="select"
          aria-label="Ramos do estribo"
          title="Número de ramos"
          style={{ height: 22, fontSize: 11 }}
          disabled={disabled}
          value={st.legs ?? 2}
          onChange={(e) => set({ ...key, legs: Number(e.target.value) === 2 ? undefined : Number(e.target.value) })}
        >
          <option value={2}>2 ramos</option>
          <option value={4}>4 ramos</option>
          <option value={6}>6 ramos</option>
        </select>
        <span className="muted" style={muted}>
          c/
        </span>
        <NumberField
          value={Math.round(st.spacing * 100)}
          digits={0}
          min={5}
          max={30}
          disabled={disabled}
          title="Passo do trecho central (ou do vão inteiro)"
          style={{ width: 38 }}
          onCommit={(v) => set({ ...key, spacing: Math.max(0.05, v / 100) })}
        />
        <span className="muted" style={muted}>
          cm
        </span>
      </span>
      {zone('left', 'esq.')}
      {zone('right', 'dir.')}
      <span className="faint" style={{ fontSize: 10.5 }}>
        programa: {programa}
      </span>
    </div>
  )
}

const cm2 = (a: number) => (a * 1e4).toFixed(2).replace('.', ',')

export function BeamRebarEditor({ beamId }: { beamId: string }) {
  const results = useStore((s) => s.results)
  const project = useStore((s) => s.project)
  const clear = useStore((s) => s.clearRebarOverrides)
  if (!results) return null
  const spans = results.detailing.beams
    .filter((b) => b.beamId === beamId)
    .sort((a, b) => a.spanIndex - b.spanIndex)
  if (spans.length === 0) return null
  const checks: BeamRebarCheck[] = (results.detailing.checks?.beams ?? []).filter((c) => c.beamId === beamId)
  const overridden = (project.rebarOverrides ?? []).some((o) => o.beamId === beamId)
  const off = !!project.rebarOverridesOff
  const worst = checks.some((c) => c.status === 'falha')
    ? 'falha'
    : checks.some((c) => c.status === 'atencao')
      ? 'atencao'
      : 'ok'
  return (
    <Frame
      testId="beam-rebar-editor"
      title={`Editor de armaduras${overridden ? (off ? ' — ajustes guardados (mostrando o programa)' : ' — ajustes manuais ativos') : ''}`}
      right={
        <>
          <StatusChip status={worst} manual={overridden && !off} />
          <SolutionToggle />
          {overridden && (
            <button
              className="btn"
              style={{ fontSize: 11, padding: '1px 8px' }}
              onClick={(e) => {
                e.stopPropagation()
                clear(beamId)
              }}
            >
              Restaurar automático
            </button>
          )}
        </>
      }
    >
      {spans.map((sp) => {
        const bd = results.beamDesign.find((b) => b.beamId === beamId && b.spanIndex === sp.spanIndex)
        const ck = checks.find((c) => c.spanIndex === sp.spanIndex)
        const prog = (fd: { bars: string; as: number } | null | undefined) =>
          fd ? `${fd.bars} (As = ${cm2(fd.as)} cm²)` : '—'
        return (
          <div key={sp.spanIndex} style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>
                vão {sp.spanIndex + 1} — {sp.length.toFixed(2).replace('.', ',')} m
              </span>
              {ck && <StatusChip status={ck.status} manual={ck.manual} />}
            </div>
            <BarSlot
              label="positivo"
              beamId={beamId}
              spanIndex={sp.spanIndex}
              slot="positive"
              bar={sp.positive}
              programa={prog(bd?.positive)}
              disabled={off}
            />
            {sp.negLeft && (
              <BarSlot
                label="neg. esq."
                beamId={beamId}
                spanIndex={sp.spanIndex}
                slot="negLeft"
                bar={sp.negLeft}
                programa={prog(bd?.negLeft)}
                disabled={off}
              />
            )}
            {sp.negRight && (
              <BarSlot
                label="neg. dir."
                beamId={beamId}
                spanIndex={sp.spanIndex}
                slot="negRight"
                bar={sp.negRight}
                programa={prog(bd?.negRight)}
                disabled={off}
              />
            )}
            <StirrupRow beamId={beamId} span={sp} programa={bd?.shear.spec ?? '—'} disabled={off} />
            {ck && <CheckList items={ck.items} testId={`beam-checks-${sp.spanIndex}`} />}
          </div>
        )
      })}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
        Os ajustes ficam no projeto e entram no quadro de ferros e nos quantitativos. As verificações
        são refeitas com a armadura adotada e, depois de uma nova análise, com os esforços novos — a
        decisão (e a responsabilidade) é do engenheiro.
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------------------
// pilares
// ---------------------------------------------------------------------------

export function ColumnRebarEditor({ columnId }: { columnId: string }) {
  const results = useStore((s) => s.results)
  const project = useStore((s) => s.project)
  const set = useStore((s) => s.setColumnRebarOverride)
  const clear = useStore((s) => s.clearColumnRebarOverride)
  if (!results) return null
  const det = results.detailing.columns.find((c) => c.columnId === columnId)
  const cd = results.columnDesign.find((c) => c.columnId === columnId)
  if (!det || !cd) return null
  const ck: ColumnRebarCheck | undefined = results.detailing.checks?.columns.find((c) => c.columnId === columnId)
  const ov = project.columnRebarOverrides?.find((o) => o.columnId === columnId)
  const off = !!project.rebarOverridesOff
  const circle = cd.section.shape === 'circle' || cd.section.shape === 'L'
  const ns = circle ? [6, 8, 10, 12, 14, 16, 20] : [4, 6, 8, 10, 12, 14, 16, 20]
  return (
    <Frame
      testId="column-rebar-editor"
      title={`Editor de armaduras — ${det.name}${ov ? (off ? ' — ajuste guardado (mostrando o programa)' : ' — ajuste manual ativo') : ''}`}
      right={
        <>
          {ck && <StatusChip status={ck.status} manual={ck.manual} />}
          <SolutionToggle />
          {ov && (
            <button
              className="btn"
              style={{ fontSize: 11, padding: '1px 8px' }}
              onClick={(e) => {
                e.stopPropagation()
                clear(columnId)
              }}
            >
              Restaurar automático
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0 2px' }}>
        <span className="muted" style={{ ...muted, width: 62 }}>
          longitudinal
        </span>
        <span style={cell}>
          <select
            className="select"
            aria-label="Quantidade de barras do pilar"
            style={{ height: 22, fontSize: 11 }}
            disabled={off}
            value={det.barsN}
            onChange={(e) => set({ columnId, n: Number(e.target.value), phi: det.barsPhi })}
          >
            {[...new Set([...ns, det.barsN])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n} barras
                </option>
              ))}
          </select>
          <PhiSelect
            value={det.barsPhi}
            options={COLUMN_BAR_MM}
            label="Bitola das barras do pilar"
            disabled={off}
            onChange={(p) => set({ columnId, n: det.barsN, phi: p })}
          />
        </span>
        <span className="faint" style={{ fontSize: 10.5 }}>
          programa: {cd.bars} (As = {cm2(cd.as)} cm²)
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '2px 0' }}>
        <span className="muted" style={{ ...muted, width: 62 }}>
          estribo
        </span>
        <span style={cell}>
          <PhiSelect
            value={det.stirrupPhi}
            options={STIRRUP_MM}
            label="Bitola do estribo do pilar"
            disabled={off}
            onChange={(p) => set({ columnId, stirrupPhi: p })}
          />
          <span className="muted" style={muted}>
            c/
          </span>
          <NumberField
            value={Math.round(det.stirrupSpacing * 100)}
            digits={0}
            min={5}
            max={30}
            disabled={off}
            title="Passo corrente dos estribos"
            style={{ width: 38 }}
            onCommit={(v) => set({ columnId, stirrupSpacing: v / 100 })}
          />
          <span className="muted" style={muted}>
            cm
          </span>
        </span>
        <span style={cell} title="Trecho acima e abaixo de cada pavimento com passo menor (região dos nós). Comprimento vazio = passo único">
          <span className="muted" style={muted}>
            junto aos nós:
          </span>
          <OptionalNumberField
            value={det.jointLength !== undefined ? Math.round(det.jointLength * 100) : undefined}
            digits={0}
            min={10}
            max={200}
            disabled={off}
            placeholder="—"
            style={{ width: 44 }}
            onCommit={(v) =>
              set({
                columnId,
                jointLength: v === undefined ? undefined : v / 100,
                jointSpacing: v === undefined ? undefined : (det.jointSpacing ?? Math.min(0.1, det.stirrupSpacing)),
              })
            }
          />
          <span className="muted" style={muted}>
            cm c/
          </span>
          <NumberField
            value={Math.round((det.jointSpacing ?? Math.min(0.1, det.stirrupSpacing)) * 100)}
            digits={0}
            min={5}
            max={30}
            disabled={off || det.jointLength === undefined}
            style={{ width: 38 }}
            onCommit={(v) => set({ columnId, jointSpacing: v / 100 })}
          />
        </span>
        <span className="faint" style={{ fontSize: 10.5 }}>
          programa: {cd.stirrupSpec}
        </span>
      </div>
      {ck && <CheckList items={ck.items} testId="column-checks" />}
      <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
        A flexo-compressão oblíqua é refeita na curva de interação com as barras adotadas. O
        traspasse acompanha a bitola escolhida.
      </div>
    </Frame>
  )
}
