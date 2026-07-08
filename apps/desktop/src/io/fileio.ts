import { parseProject, serializeProject, type Project } from '@hyperframe/engine'

/**
 * Salvamento/abertura de projeto (.hyperframe.json).
 * v0: download/upload via browser — funciona no Vite dev e no WebView do Tauri.
 * (roadmap: diálogos nativos via @tauri-apps/plugin-dialog)
 */

export function saveProjectFile(project: Project, fileName?: string | null): string {
  const name =
    fileName ?? `${project.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'projeto'}.hyperframe.json`
  const blob = new Blob([serializeProject(project)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return name
}

export function openProjectFile(): Promise<{ project: Project; fileName: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.hyperframe'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        const text = await file.text()
        resolve({ project: parseProject(text), fileName: file.name })
      } catch (err) {
        reject(err)
      }
    }
    // cancelamento silencioso
    input.oncancel = () => resolve(null)
    input.click()
  })
}
