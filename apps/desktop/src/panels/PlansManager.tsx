import { useMemo, useState } from 'react'
import { MIN_LEVEL_GAP, useStore } from '../store'
import { fmt } from './format'
import { NumberField } from './NumberField'
import { IconClose } from '../components/Icons'

/**
 * Gerenciador de plantas de forma: atribuição planta ↔ nível, pé-direito
 * variável por pavimento, adicionar/remover níveis em projeto existente,
 * renomear, duplicar e excluir plantas. Modal condicionado a `plansManagerOpen`.
 */
export default function PlansManager() {
  const open = useStore((s) => s.plansManagerOpen)
  const setOpen = useStore((s) => s.setPlansManagerOpen)
  const project = useStore((s) => s.project)
  const addPlan = useStore((s) => s.addPlan)
  const renamePlan = useStore((s) => s.renamePlan)
  const assignPlanToLevel = useStore((s) => s.assignPlanToLevel)
  const deletePlan = useStore((s) => s.deletePlan)
  const setStoryHeight = useStore((s) => s.setStoryHeight)
  const renameLevel = useStore((s) => s.renameLevel)
  const addLevel = useStore((s) => s.addLevel)
  const deleteLevel = useStore((s) => s.deleteLevel)
  const setLevelElevation = useStore((s) => s.setLevelElevation)

  // formulário "novo nível": posição ('' = acima do topo; '_below' = abaixo da base)
  const [addPos, setAddPos] = useState<string>('')
  const [addHeight, setAddHeight] = useState(3)
  const [extendCols, setExtendCols] = useState(true)
  // modo de inserção/remoção: 'shift' = sucessivo (desloca os níveis acima);
  // 'keep' = independente (cota referenciada a um nível, os demais não se movem)
  const [mode, setMode] = useState<'shift' | 'keep'>('shift')
  const [refId, setRefId] = useState<string>('')
  const [offset, setOffset] = useState(3)

  const sortedLevels = useMemo(
    () => [...project.levels].sort((a, b) => a.elevation - b.elevation),
    [project.levels],
  )

  /** níveis ancorando base/topo de pilar ou consolo — não podem ser removidos */
  const anchoredLevels = useMemo(() => {
    const set = new Set<string>()
    for (const c of project.columns) {
      set.add(c.baseLevelId)
      set.add(c.topLevelId)
      for (const cb of c.corbels ?? []) set.add(cb.levelId)
    }
    return set
  }, [project.columns])

  const topLevel = sortedLevels[sortedLevels.length - 1]
  const addAboveId = addPos === '' ? (topLevel?.id ?? null) : addPos === '_below' ? null : addPos
  const independent = mode === 'keep'
  // referência padrão = topo: +3 m nunca coincide com um nível existente
  const refLevel = sortedLevels.find((l) => l.id === refId) ?? sortedLevels[sortedLevels.length - 1]
  const newElevation = refLevel ? refLevel.elevation + offset : 0
  /** nível existente que impediria a criação do nível independente */
  const clash = independent
    ? sortedLevels.find((l) => Math.abs(l.elevation - newElevation) < MIN_LEVEL_GAP - 1e-9)
    : undefined
  const addingNewTop = independent
    ? !!topLevel && newElevation > topLevel.elevation
    : addAboveId !== null && addAboveId === topLevel?.id

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
          <h3 className="panel-title">Níveis (pé-direito variável)</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Nível</th>
                <th title="Distância ao nível inferior — editar desloca este nível e os acima">
                  Pé-direito (m)
                </th>
                <th title="Cota do nível — editar move só este nível (os demais não se deslocam)">
                  Cota (m)
                </th>
                <th>Planta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sortedLevels.map((l, i) => {
                const below = i > 0 ? sortedLevels[i - 1] : null
                const height = below ? l.elevation - below.elevation : null
                return (
                  <tr key={l.id}>
                    <td>
                      <input
                        className="input"
                        style={{ width: '100%', fontFamily: 'var(--sans)', fontWeight: 600 }}
                        value={l.name}
                        spellCheck={false}
                        onChange={(e) => renameLevel(l.id, e.target.value)}
                      />
                    </td>
                    <td>
                      {height === null ? (
                        <span className="faint">—</span>
                      ) : (
                        <NumberField
                          value={height}
                          digits={2}
                          min={1}
                          max={10}
                          style={{ width: 76 }}
                          onCommit={(v) => setStoryHeight(l.id, v)}
                        />
                      )}
                    </td>
                    <td>
                      <NumberField
                        value={l.elevation}
                        digits={2}
                        min={below ? below.elevation + MIN_LEVEL_GAP : -60}
                        max={
                          i < sortedLevels.length - 1
                            ? sortedLevels[i + 1].elevation - MIN_LEVEL_GAP
                            : 400
                        }
                        style={{ width: 76 }}
                        onCommit={(v) => setLevelElevation(l.id, v)}
                      />
                    </td>
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
                    <td style={{ width: 28 }}>
                      {(() => {
                        const anchored = anchoredLevels.has(l.id)
                        const last = sortedLevels.length <= 2
                        const blocked = anchored || last
                        return (
                          <button
                            className="btn-icon"
                            disabled={blocked}
                            title={
                              anchored
                                ? 'Em uso — há pilar (base/topo) ou consolo ancorado neste nível'
                                : last
                                  ? 'O projeto precisa de pelo menos 2 níveis'
                                  : independent
                                    ? 'Remover nível (os demais mantêm a cota)'
                                    : 'Remover nível (os superiores descem o pé-direito removido)'
                            }
                            style={{
                              color: blocked ? undefined : 'var(--err)',
                              opacity: blocked ? 0.35 : 1,
                              fontSize: 13,
                            }}
                            onClick={() => deleteLevel(l.id, { keepElevations: independent })}
                          >
                            ✕
                          </button>
                        )
                      })()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* --------------------------------------------- novo nível */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 8,
              padding: '8px 10px',
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>＋ Novo nível</span>
            <select
              className="select"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'shift' | 'keep')}
              title={
                'Sucessivo: o nível entra na sequência e desloca os que estão acima.\n' +
                'Independente: cota medida a partir de um nível de referência; nenhum outro nível se move.'
              }
              style={{ flex: 'none' }}
            >
              <option value="shift">sucessivo</option>
              <option value="keep">independente</option>
            </select>
            {independent ? (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  a
                  <NumberField
                    value={offset}
                    digits={2}
                    min={-60}
                    max={60}
                    style={{ width: 64 }}
                    onCommit={setOffset}
                  />
                  m de
                </label>
                <select
                  className="select"
                  value={refLevel?.id ?? ''}
                  onChange={(e) => setRefId(e.target.value)}
                  style={{ flex: '1 1 120px', minWidth: 110 }}
                >
                  {sortedLevels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({fmt(l.elevation, 2)})
                    </option>
                  ))}
                </select>
                <span className="mono" title="Cota resultante do novo nível">
                  → cota {fmt(newElevation, 2)}
                </span>
              </>
            ) : (
              <>
                <select
                  className="select"
                  value={addPos}
                  onChange={(e) => setAddPos(e.target.value)}
                  style={{ flex: '1 1 150px', minWidth: 130 }}
                >
                  <option value="">acima do topo ({topLevel?.name ?? '—'})</option>
                  {sortedLevels
                    .slice(0, -1)
                    .reverse()
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        acima de {l.name}
                      </option>
                    ))}
                  <option value="_below">abaixo de {sortedLevels[0]?.name ?? '—'} (subsolo)</option>
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  pé-direito
                  <NumberField
                    value={addHeight}
                    digits={2}
                    min={1}
                    max={10}
                    style={{ width: 64 }}
                    onCommit={setAddHeight}
                  />
                  m
                </label>
              </>
            )}
            {addingNewTop && (
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                title="Pilares que terminam no topo atual passam a subir até o novo nível"
              >
                <input
                  type="checkbox"
                  checked={extendCols}
                  onChange={(e) => setExtendCols(e.target.checked)}
                />
                estender pilares
              </label>
            )}
            <button
              className="btn"
              disabled={!!clash}
              title={
                clash
                  ? `A cota fica a menos de ${fmt(MIN_LEVEL_GAP, 2)} m de ${clash.name}`
                  : undefined
              }
              onClick={() =>
                independent
                  ? addLevel({
                      aboveLevelId: refLevel?.id ?? null,
                      height: offset,
                      extendColumns: addingNewTop && extendCols,
                      independent: true,
                    })
                  : addLevel({
                      aboveLevelId: addAboveId,
                      height: addHeight,
                      extendColumns: addingNewTop && extendCols,
                    })
              }
            >
              Adicionar
            </button>
          </div>
          {clash && (
            <div style={{ fontSize: 11, marginTop: 6, color: 'var(--err)' }}>
              A cota {fmt(newElevation, 2)} m fica a menos de {fmt(MIN_LEVEL_GAP, 2)} m de{' '}
              {clash.name} ({fmt(clash.elevation, 2)} m). Ajuste a distância.
            </div>
          )}
          <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
            ⚠ Alterar níveis, pé-direito ou atribuição de plantas invalida os resultados da
            análise. O nível novo nasce sem planta — atribua uma existente ou crie abaixo.
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
