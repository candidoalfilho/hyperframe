import type { SlabDesignResultItem } from '@hyperframe/engine'
import { fmt } from './format'

const StatusChip = ({ s }: { s: 'ok' | 'atencao' | 'falha' }) =>
  s === 'ok' ? (
    <span className="chip ok">OK</span>
  ) : s === 'atencao' ? (
    <span className="chip warn">Atenção</span>
  ) : (
    <span className="chip err">Falha</span>
  )

/**
 * Lajes com cargas concentradas ou lineares (issue #8): resultante, efeito na
 * laje (amplificação dos momentos / vigota crítica) e punção sob as pontuais.
 */
export default function SlabLoadsResults({ items }: { items: SlabDesignResultItem[] }) {
  const conc = items.filter((i) => i.concentrated)
  if (conc.length === 0) return null
  const punch = conc.flatMap((s) => s.concentrated!.punching.map((p) => ({ s, p })))
  return (
    <>
      <h3 className="panel-title" style={{ marginTop: 18 }}>
        Cargas concentradas e lineares sobre lajes
      </h3>
      <table className="table">
        <thead>
          <tr>
            <th>Laje</th>
            <th>Pavimento</th>
            <th>Cargas</th>
            <th style={{ textAlign: 'right' }}>G (kN)</th>
            <th style={{ textAlign: 'right' }}>Q (kN)</th>
            <th>Efeito na laje</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {conc.map((s) => {
            const c = s.concentrated!
            const j = c.joist
            return (
              <tr key={`${s.slabId}-${s.levelName}`}>
                <td>{s.name}</td>
                <td>{s.levelName}</td>
                <td>{c.loads.map((l) => l.name).join(', ')}</td>
                <td style={{ textAlign: 'right' }}>{fmt(c.totalG, 1)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(c.totalQ, 1)}</td>
                <td>
                  {j ? (
                    j.spread ? (
                      <>
                        todas as vigotas: +{fmt(j.m, 2)} kN·m e +{fmt(j.v, 2)} kN · carga equivalente ×
                        {fmt(c.factor, 2)}
                      </>
                    ) : (
                      <>
                        vigota crítica: +{fmt(j.m, 2)} kN·m e +{fmt(j.v, 2)} kN ·{' '}
                        {j.juxtaposed > 1 ? (
                          <b>{j.juxtaposed} vigotas justapostas</b>
                        ) : (
                          'sem reforço'
                        )}
                      </>
                    )
                  ) : c.kx !== undefined ? (
                    <>
                      momentos ×{fmt(c.kx, 2)} (X) · ×{fmt(c.ky ?? 1, 2)} (Y) · flecha ×
                      {fmt(c.kw ?? 1, 2)}
                    </>
                  ) : (
                    <span className="faint">não verificado (laje sem borda apoiada)</span>
                  )}
                </td>
                <td>
                  <StatusChip s={s.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {punch.length > 0 && (
        <table className="table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Laje</th>
              <th>Carga pontual</th>
              <th>Área (cm)</th>
              <th style={{ textAlign: 'right' }}>FSd (kN)</th>
              <th style={{ textAlign: 'right' }}>τSd em C′ (kPa)</th>
              <th style={{ textAlign: 'right' }}>τRd1 (kPa)</th>
              <th style={{ textAlign: 'right' }}>τSd em C (kPa)</th>
              <th style={{ textAlign: 'right' }}>τRd2 (kPa)</th>
              <th>Punção</th>
            </tr>
          </thead>
          <tbody>
            {punch.map(({ s, p }) => (
              <tr key={`${s.slabId}-${s.levelName}-${p.loadId}`}>
                <td>{s.name}</td>
                <td>{p.name}</td>
                <td>
                  {fmt(p.bx * 100, 0)}×{fmt(p.by * 100, 0)}
                </td>
                <td style={{ textAlign: 'right' }}>{fmt(p.fsd, 1)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(p.check.tauSd1, 0)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(p.check.tauRd1, 0)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(p.check.tauSd0, 0)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(p.check.tauRd2, 0)}</td>
                <td>
                  {!p.check.okC ? (
                    <span className="chip err">Falha</span>
                  ) : p.check.needsShearReinf ? (
                    <span className="chip warn">Armar</span>
                  ) : (
                    <span className="chip ok">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="faint" style={{ fontSize: 11, lineHeight: 1.55, margin: '6px 0 4px' }}>
        Momentos e flecha: razão entre a grelha da laje com e sem as cargas concentradas (pico sob
        a carga numa faixa de 25 cm). Marcus e nervuradas usam a maior razão como carga uniforme
        equivalente. Punção: NBR 6118 §19.5, contorno C′ a 2d da área carregada. Vigotas: esforços
        característicos adicionais na vigota sob a carga, biapoiada. As reações já estão nas vigas,
        na posição em que ocorrem.
      </div>
    </>
  )
}
