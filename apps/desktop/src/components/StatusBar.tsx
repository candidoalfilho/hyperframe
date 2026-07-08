import { useActivePlan, useStore } from '../store'

export default function StatusBar() {
  const cursor = useStore((s) => s.cursorWorld)
  const project = useStore((s) => s.project)
  const plan = useActivePlan()
  const analysisStatus = useStore((s) => s.analysisStatus)
  const analysisError = useStore((s) => s.analysisError)
  const results = useStore((s) => s.results)
  const tool = useStore((s) => s.tool)

  const toolHints: Record<string, string> = {
    select: 'clique para selecionar · Delete exclui',
    column: 'clique para inserir pilar (snap nos eixos)',
    beam: 'clique os pontos da viga · Enter/duplo-clique finaliza · Esc cancela',
    slab: 'clique dentro de um contorno fechado de vigas',
    wall: 'clique na viga para aplicar carga de alvenaria',
  }

  return (
    <div className="statusbar">
      <span>
        {cursor ? `x ${cursor.x.toFixed(2)} m · y ${cursor.y.toFixed(2)} m` : '—'}
      </span>
      <span className="faint">{toolHints[tool]}</span>
      <span className="spacer" />
      {analysisStatus === 'error' && (
        <span style={{ color: 'var(--err)' }}>Erro: {analysisError}</span>
      )}
      {analysisStatus === 'done' && results && (
        <span style={{ color: 'var(--ok)' }}>
          Análise ok · {results.model.stats.nodes} nós · {results.model.stats.members} barras ·{' '}
          {results.model.stats.dofs} GDL · {results.elapsedMs.toFixed(0)} ms
        </span>
      )}
      {analysisStatus === 'running' && <span style={{ color: 'var(--warn)' }}>Analisando…</span>}
      <span>
        {project.columns.length} pilares · {plan?.beams.length ?? 0} vigas ·{' '}
        {plan?.slabs.length ?? 0} lajes
      </span>
      <span className="faint">kN · m · cm (seções)</span>
    </div>
  )
}
