import { useCallback, useEffect, useState } from 'react'
import { parseProject } from '@hyperframe/engine'
import { exportProjectFile } from '../io/fileio'
import { useStore } from '../store'
import { webProjectId } from './route'
import { askName } from './NamePrompt'
import {
  deleteWebProject,
  getWebProject,
  listWebProjects,
  renameWebProject,
  type WebProjectMeta,
} from './storage'
import { openWebProject } from './useWebRouting'

const fail = (err: unknown) => alert(err instanceof Error ? err.message : String(err))

/** "Meus projetos" (build web): projetos guardados no IndexedDB deste navegador. */
export default function ProjectsList({ relWhen }: { relWhen: (iso: string) => string }) {
  const [items, setItems] = useState<WebProjectMeta[] | null>(null)
  const currentId = useStore((s) => webProjectId(s.fileName))

  const refresh = useCallback(() => {
    listWebProjects().then(setItems, (err) => {
      setItems([])
      fail(err)
    })
  }, [])
  useEffect(refresh, [refresh])

  const open = async (id: string) => {
    try {
      if (!(await openWebProject(id))) {
        alert('Projeto não encontrado neste navegador.')
        refresh()
      }
    } catch (err) {
      fail(err)
    }
  }
  const rename = async (p: WebProjectMeta) => {
    const name = await askName('Renomear projeto', 'Nome do arquivo', p.name)
    if (!name || name === p.name) return
    await renameWebProject(p.id, name).catch(fail)
    refresh()
  }
  const exportOne = async (p: WebProjectMeta) => {
    try {
      const rec = await getWebProject(p.id)
      if (rec) await exportProjectFile(parseProject(rec.data), rec.name)
    } catch (err) {
      fail(err)
    }
  }
  const remove = async (p: WebProjectMeta) => {
    if (!confirm(`Excluir “${p.name}” deste navegador? Esta ação não pode ser desfeita.`)) return
    await deleteWebProject(p.id).catch(fail)
    if (p.id === currentId) useStore.setState({ fileName: null, dirty: true })
    refresh()
  }

  return (
    <div className="welcome-recents">
      <div className="welcome-recents-title">Meus projetos</div>
      {items === null ? null : items.length === 0 ? (
        <div className="welcome-empty">
          Projetos salvos ficam neste navegador e aparecem aqui. Use “Exportar” para guardar uma
          cópia .hyperframe.json no seu computador.
        </div>
      ) : (
        items.map((p) => (
          <div
            key={p.id}
            className="welcome-recent"
            role="button"
            tabIndex={0}
            data-project-id={p.id}
            onClick={() => void open(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void open(p.id)
            }}
          >
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="wr-name" style={{ display: 'block' }}>
                {p.name}
              </span>
              <span className="wr-path" style={{ display: 'block' }}>
                atualizado em {new Date(p.updatedAt).toLocaleString('pt-BR')}
              </span>
            </span>
            <span className="wr-when">{relWhen(p.updatedAt)}</span>
            {(
              [
                ['✎', 'Renomear', rename],
                ['⤓', 'Exportar .hyperframe.json', exportOne],
                ['×', 'Excluir', remove],
              ] as const
            ).map(([glyph, title, fn]) => (
              <button
                key={title}
                className="wr-x"
                title={title}
                aria-label={title}
                onClick={(e) => {
                  e.stopPropagation()
                  void fn(p)
                }}
              >
                {glyph}
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
