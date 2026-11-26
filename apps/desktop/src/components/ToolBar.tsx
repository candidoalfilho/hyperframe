import type { JSX } from 'react'
import { useStore, type Tool } from '../store'
import {
  IconBeam,
  IconColumn,
  IconCursor,
  IconSlab,
  IconStairs,
  IconTrash,
  IconWall,
  IconMasonry,
  IconRuler,
  IconSlabLoad,
  IconDimension,
} from './Icons'

const tools: { id: Tool; title: string; icon: (p: { size?: number }) => JSX.Element }[] = [
  {
    id: 'select',
    title: 'Selecionar (V ou Esc) — Shift+clique soma · arraste no vazio abre janela · ⌘/Ctrl+A tudo',
    icon: IconCursor,
  },
  { id: 'column', title: 'Pilar (P) — clique na posição · G gira 90°', icon: IconColumn },
  { id: 'beam', title: 'Viga (B) — clique nos pontos, Enter/duplo-clique finaliza', icon: IconBeam },
  { id: 'slab', title: 'Laje (L) — clique dentro de um contorno fechado de vigas', icon: IconSlab },
  { id: 'wall', title: 'Carga de parede (W) — clique na viga', icon: IconWall },
  {
    id: 'slabload',
    title:
      'Carga na laje (C) — pontual: 1 clique · linear (parede sobre a laje): 2 cliques. Tipo e valores no painel',
    icon: IconSlabLoad,
  },
  {
    id: 'mwall',
    title: 'Alvenaria estrutural (M) — parede NBR 16868: clique nos pontos, Enter finaliza',
    icon: IconMasonry,
  },
  {
    id: 'region',
    title: 'Região de carga (R) — escada/reservatório: clique os vértices, Enter fecha',
    icon: IconStairs,
  },
  {
    id: 'measure',
    title: 'Medir (D) — clique os pontos: distância por trecho e acumulada · Enter conclui · Esc limpa',
    icon: IconRuler,
  },
  {
    id: 'dim',
    title:
      'Cota (T) — cota permanente: clique os pontos e depois a posição da linha · tipo e forma no painel',
    icon: IconDimension,
  },
]

export default function ToolBar() {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const deleteSelected = useStore((s) => s.deleteSelected)
  const selection = useStore((s) => s.selection)

  return (
    <div className="toolbar">
      {tools.map((t) => {
        const Icon = t.icon
        return (
          <button
            key={t.id}
            className={`btn-icon tip-right ${tool === t.id ? 'active' : ''}`}
            data-tip={t.title}
            onClick={() => setTool(t.id)}
          >
            <Icon size={18} />
          </button>
        )
      })}
      <div style={{ flex: 1 }} />
      <button
        className="btn-icon tip-right"
        data-tip="Excluir seleção (Delete)"
        disabled={!selection}
        onClick={deleteSelected}
      >
        <IconTrash size={18} />
      </button>
    </div>
  )
}
