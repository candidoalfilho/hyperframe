import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { analyze, createSampleProject, type ElementRef } from '@hyperframe/engine'
import MemorialDialog, { memorialOptionsFrom } from '../src/panels/MemorialDialog'
import { PANEL_MIN, clampPanelHeight, panelHeightFromPointer } from '../src/panels/panelHeight'

/** issue #11 — diálogo do memorial e painel de resultados redimensionável */

describe('opções do memorial a partir do diálogo', () => {
  const sel: ElementRef[] = [
    { kind: 'beam', id: 'b1' },
    { kind: 'column', id: 'c1' },
    { kind: 'column', id: 'c2' },
    { kind: 'wallLoad', id: 'w1' },
  ]
  const all = {
    sections: ['global', 'vigas', 'pilares'] as const,
    diagrams: ['V', 'M'] as const,
  }

  it('resumido não leva nenhuma opção do anexo', () => {
    expect(
      memorialOptionsFrom({ detail: 'resumido', sections: [...all.sections], diagrams: [...all.diagrams], onlySelection: true, selection: sel }),
    ).toEqual({ detail: 'resumido' })
  })

  it('detalhado: seções e diagramas na ordem do documento; sem filtro de elementos', () => {
    expect(
      memorialOptionsFrom({ detail: 'detalhado', sections: [...all.sections], diagrams: [...all.diagrams], onlySelection: false, selection: sel }),
    ).toEqual({ detail: 'detalhado', sections: ['vigas', 'pilares', 'global'], diagrams: ['M', 'V'] })
  })

  it('só a seleção: ids por tipo, e os tipos sem seleção ficam vazios (não "todos")', () => {
    const o = memorialOptionsFrom({ detail: 'detalhado', sections: ['vigas'], diagrams: [], onlySelection: true, selection: sel })
    expect(o.only).toEqual({ beams: ['b1'], columns: ['c1', 'c2'], slabs: [] })
    expect(o.diagrams).toEqual([])
  })
})

describe('diálogo', () => {
  const project = createSampleProject()
  const results = analyze(project)
  const html = (selection: ElementRef[]) =>
    renderToStaticMarkup(<MemorialDialog project={project} results={results} selection={selection} onClose={() => {}} />)

  it('abre no resumido, com as duas opções de nível de detalhe e o botão de gerar', () => {
    const h = html([])
    expect(h).toContain('role="dialog"')
    expect(h).toContain('<b>Resumido</b>')
    expect(h).toContain('<b>Detalhado</b>')
    expect(h).toContain('Gerar PDF')
    // as escolhas do anexo só aparecem no detalhado
    expect(h).not.toContain('O que entra no anexo')
  })
})

describe('altura do painel de resultados', () => {
  it('fica entre o mínimo e o que cabe na janela', () => {
    expect(clampPanelHeight(50, 900)).toBe(PANEL_MIN)
    expect(clampPanelHeight(400, 900)).toBe(400)
    expect(clampPanelHeight(5000, 900)).toBe(900 - 68)
    // janela minúscula: nunca abaixo do mínimo
    expect(clampPanelHeight(300, 100)).toBe(PANEL_MIN)
  })

  it('a borda de cima segue o ponteiro; a barra de status (24 px) fica de fora', () => {
    // janela de 1000 px, ponteiro a 400 px do topo ⇒ painel de 1000 − 400 − 24
    expect(panelHeightFromPointer(400, 1000, 1)).toBe(576)
    // ponteiro lá em cima: limita ao máximo
    expect(panelHeightFromPointer(0, 1000, 1)).toBe(1000 - 68)
    // ponteiro quase no fim: mínimo
    expect(panelHeightFromPointer(990, 1000, 1)).toBe(PANEL_MIN)
  })

  it('com o zoom da interface em 130%, as medidas vêm em px visuais', () => {
    // 1300 px visuais = 1000 px CSS; ponteiro a 520 visuais = 400 CSS
    expect(panelHeightFromPointer(520, 1300, 1.3)).toBe(576)
  })
})
