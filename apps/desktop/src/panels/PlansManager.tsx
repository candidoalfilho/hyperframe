import { useMemo } from 'react'
import { useStore } from '../store'
import { fmt } from './format'
import { IconClose } from '../components/Icons'

/**
 * Gerenciador de plantas de forma: atribuição planta ↔ nível, renomear,
 * duplicar e excluir plantas. Modal condicionado a `plansManagerOpen`.
 */
export default function PlansManager() {
  const open = useStore((s) => s.plansManagerOpen)
  const setOpen = useStore((s) => s.setPlansManagerOpen)
  const project = useStore((s) => s.project)
  const addPlan = useStore((s) => s.addPlan)
  const renamePlan = useStore((s) => s.renamePlan)
  const assignPlanToLevel = useStore((s) => s.assignPlanToLevel)
  const deletePlan = useStore((s) => s.deletePlan)

  const usage = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of project.levels) {
      if (l.planId) map.set(l.planId, (map.get(l.planId) ?? 0) + 1)
    }
    return map
  }, [project.levels])

  if (!open) return null

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 560, maxWidth: 560 }}>
        <div className="modal-header">
          Plantas de forma
          <button className="btn-icon" title="Fechar" onClick={() => setOpen(false)}>
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* --------------------------------------------- atribuição */}
          <h3 className="panel-title">Atribuição por nível</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Nível</th>
                <th>Cota (m)</th>
                <th>Planta</th>
              </tr>
            </thead>
            <tbody>
              {project.levels.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontFamily: 'var(--sans)', fontWeight: 600 }}>{l.name}</td>
                  <td>{fmt(l.elevation, 2)}</td>
                  <td>
                    <select
                      className="select"
                      style={{ width: '100%' }}
                      value={l.planId ?? ''}
                      onChange={(e) => assignPlanToLevel(l.id, e.target.value || null)}
                    >
                      <option value="">— sem planta —</option>
                      {project.plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
            ⚠ Alterar a atribuição de plantas invalida os resultados da análise.
          </div>

          {/* --------------------------------------------- plantas */}
          <div className="panel-section">
            <h3 className="panel-title">Plantas do projeto</h3>
            {project.plans.length === 0 && (
              <div className="faint" style={{ fontSize: 12, padding: '4px 0' }}>
                Nenhuma planta no projeto.
              </div>
            )}
            {project.plans.map((p) => {
              const n = usage.get(p.id) ?? 0
              return (
                <div
                  key={p.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
                >
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 0 }}
                    value={p.name}
                    spellCheck={false}
                    onChange={(e) => renamePlan(p.id, e.target.value)}
                  />
                  <span className="chip" style={{ flex: 'none' }}>
                    {n === 0 ? 'não usada' : `usada por ${n} ${n === 1 ? 'nível' : 'níveis'}`}
                  </span>
                  <button
                    className="btn"
                    style={{ flex: 'none' }}
                    title="Duplicar planta (vigas, lajes e cargas copiadas)"
                    onClick={() => addPlan(p.id)}
                  >
                    Duplicar
                  </button>
                  <button
                    className="btn"
                    style={{
                      flex: 'none',
                      color: n > 0 ? undefined : 'var(--err)',
                      borderColor: n > 0 ? undefined : 'rgba(255, 92, 105, 0.45)',
                    }}
                    disabled={n > 0}
                    title={
                      n > 0
                        ? 'Em uso — desatribua dos níveis antes de excluir'
                        : 'Excluir planta'
                    }
                    onClick={() => deletePlan(p.id)}
                  >
                    Excluir
                  </button>
                </div>
              )
            })}
            <button className="btn" style={{ marginTop: 8 }} onClick={() => addPlan()}>
              Nova planta vazia
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <span
            className="faint"
            style={{ fontSize: 11, marginRight: 'auto', alignSelf: 'center' }}
          >
            Pilares são globais ao edifício; vigas, lajes e cargas pertencem à planta.
          </span>
          <button className="btn btn-primary" onClick={() => setOpen(false)}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
