import type { JSX } from 'react'
import { useStore, type Tool } from '../store'
import {
  IconBeam,
  IconColumn,
  IconCursor,
  IconSlab,
  IconTrash,
  IconWall,
} from './Icons'

const tools: { id: Tool; title: string; icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'select', title: 'Selecionar (V ou Esc)', icon: IconCursor },
  { id: 'column', title: 'Pilar (P) — clique na posição', icon: IconColumn },
  { id: 'beam', title: 'Viga (B) — clique nos pontos, Enter/duplo-clique finaliza', icon: IconBeam },
  { id: 'slab', title: 'Laje (L) — clique dentro de um contorno fechado de vigas', icon: IconSlab },
  { id: 'wall', title: 'Carga de parede (W) — clique na viga', icon: IconWall },
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
            className={`btn-icon ${tool === t.id ? 'active' : ''}`}
            title={t.title}
            onClick={() => setTool(t.id)}
          >
            <Icon size={18} />
          </button>
        )
      })}
      <div style={{ flex: 1 }} />
      <button
        className="btn-icon"
        title="Excluir selecionado (Delete)"
        disabled={!selection}
        onClick={deleteSelected}
      >
        <IconTrash size={18} />
      </button>
    </div>
  )
}
