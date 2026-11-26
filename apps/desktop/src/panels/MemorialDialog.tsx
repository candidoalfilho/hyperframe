import { useState } from 'react'
import {
  MEMORIAL_DIAGRAMS,
  MEMORIAL_SECTIONS,
  buildMemorialPdf,
  type AnalysisResults,
  type ElementRef,
  type MemorialDetailSection,
  type MemorialDiagram,
  type MemorialOptions,
  type Project,
} from '@hyperframe/engine'
import { exportFile } from '../io/fileio'
import { IconClose, IconPrint } from '../components/Icons'

/**
 * Geração do memorial (issue #11): resumido (resultados e verificações) ou
 * detalhado (anexo com a memória de cada elemento), com a escolha dos grupos
 * de elementos, dos diagramas e, se houver seleção, só dos elementos escolhidos.
 */

const SECTION_LABEL: Record<MemorialDetailSection, string> = {
  vigas: 'Vigas — cargas e origem, reações, flexão, cortante, torção, flecha',
  pilares: 'Pilares — descida de cargas, esbeltez, 2ª ordem, armaduras',
  lajes: 'Lajes — cargas, esforços, armaduras, flecha, reações nas bordas',
  fundacoes: 'Fundações — cargas por caso, tensões, estacas, armaduras',
  global: 'Deslocamentos horizontais da estrutura (deformada lateral)',
}

const DIAGRAM_LABEL: Record<MemorialDiagram, string> = {
  M: 'Momento fletor',
  V: 'Força cortante',
  N: 'Força normal',
  T: 'Momento torçor',
}

/** opções do memorial a partir das escolhas do diálogo (função pura — testada) */
export function memorialOptionsFrom(choice: {
  detail: 'resumido' | 'detalhado'
  sections: MemorialDetailSection[]
  diagrams: MemorialDiagram[]
  /** só os elementos selecionados (vigas, pilares e lajes) */
  onlySelection: boolean
  selection: ElementRef[]
}): Pick<MemorialOptions, 'detail' | 'sections' | 'diagrams' | 'only'> {
  if (choice.detail === 'resumido') return { detail: 'resumido' }
  const ids = (kind: ElementRef['kind']) => choice.selection.filter((r) => r.kind === kind).map((r) => r.id)
  return {
    detail: 'detalhado',
    sections: MEMORIAL_SECTIONS.filter((s) => choice.sections.includes(s)),
    diagrams: MEMORIAL_DIAGRAMS.filter((d) => choice.diagrams.includes(d)),
    ...(choice.onlySelection
      ? { only: { beams: ids('beam'), columns: ids('column'), slabs: ids('slab') } }
      : {}),
  }
}

const check = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0', cursor: 'pointer' } as const

export default function MemorialDialog({
  project,
  results,
  selection,
  onClose,
}: {
  project: Project
  results: AnalysisResults
  selection: ElementRef[]
  onClose: () => void
}) {
  const [detail, setDetail] = useState<'resumido' | 'detalhado'>('resumido')
  const [sections, setSections] = useState<MemorialDetailSection[]>([...MEMORIAL_SECTIONS])
  const [diagrams, setDiagrams] = useState<MemorialDiagram[]>([...MEMORIAL_DIAGRAMS])
  const usable = selection.filter((r) => r.kind === 'beam' || r.kind === 'column' || r.kind === 'slab')
  const [onlySelection, setOnlySelection] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const bytes = buildMemorialPdf(project, results, {
        generatedAt: new Date().toLocaleString('pt-BR'),
        appVersion: __APP_VERSION__,
        ...memorialOptionsFrom({ detail, sections, diagrams, onlySelection: onlySelection && usable.length > 0, selection }),
      })
      const base = project.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'projeto'
      await exportFile(
        bytes,
        `${base} — memorial${detail === 'detalhado' ? ' detalhado' : ''}.pdf`,
        'Memorial de cálculo (PDF)',
        'pdf',
        'application/pdf',
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const nothing = detail === 'detalhado' && sections.length === 0
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 560, maxWidth: 560 }} role="dialog" aria-label="Gerar memorial de cálculo">
        <div className="modal-header">
          <span>Memorial de cálculo</span>
          <button className="btn-icon" style={{ width: 28, height: 28 }} title="Fechar" onClick={onClose}>
            <IconClose size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="label" style={{ marginBottom: 6 }}>
            Nível de detalhe
          </div>
          <label style={check}>
            <input type="radio" name="mem-detail" checked={detail === 'resumido'} onChange={() => setDetail('resumido')} />
            <span>
              <b>Resumido</b> — resultados e verificações por elemento, em tabelas
            </span>
          </label>
          <label style={check}>
            <input type="radio" name="mem-detail" checked={detail === 'detalhado'} onChange={() => setDetail('detalhado')} />
            <span>
              <b>Detalhado</b> — o resumido mais um anexo com a memória de cada elemento: origem das cargas,
              reações, diagramas e as contas com os valores
            </span>
          </label>

          {detail === 'detalhado' && (
            <>
              <div className="label" style={{ margin: '14px 0 4px' }}>
                O que entra no anexo
              </div>
              {MEMORIAL_SECTIONS.map((s) => (
                <label key={s} style={check}>
                  <input
                    type="checkbox"
                    checked={sections.includes(s)}
                    onChange={() => setSections(toggle(sections, s))}
                  />
                  {SECTION_LABEL[s]}
                </label>
              ))}

              <div className="label" style={{ margin: '14px 0 4px' }}>
                Diagramas junto de cada viga e pilar (envoltória ELU)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 18px' }}>
                {MEMORIAL_DIAGRAMS.map((d) => (
                  <label key={d} style={check}>
                    <input
                      type="checkbox"
                      checked={diagrams.includes(d)}
                      onChange={() => setDiagrams(toggle(diagrams, d))}
                    />
                    {DIAGRAM_LABEL[d]}
                  </label>
                ))}
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                Cada gráfico traz a escala, a unidade e a combinação que produz o valor extremo. Torção e
                normal só aparecem onde não são desprezíveis.
              </div>

              <div className="label" style={{ margin: '14px 0 4px' }}>
                Elementos
              </div>
              <label style={check}>
                <input type="radio" name="mem-scope" checked={!onlySelection || usable.length === 0} onChange={() => setOnlySelection(false)} />
                Todos os elementos do projeto
              </label>
              <label style={{ ...check, opacity: usable.length === 0 ? 0.5 : 1 }}>
                <input
                  type="radio"
                  name="mem-scope"
                  disabled={usable.length === 0}
                  checked={onlySelection && usable.length > 0}
                  onChange={() => setOnlySelection(true)}
                />
                {usable.length === 0
                  ? 'Só a seleção — selecione vigas, pilares ou lajes na planta antes de abrir esta janela'
                  : `Só a seleção (${usable.length} ${usable.length === 1 ? 'elemento' : 'elementos'}) — fundações dos pilares selecionados`}
              </label>
            </>
          )}
          {error && <div style={{ color: 'var(--err)', fontSize: 12, marginTop: 10 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy || nothing} onClick={() => void generate()}>
            <IconPrint size={14} />
            {busy ? 'Gerando…' : 'Gerar PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
