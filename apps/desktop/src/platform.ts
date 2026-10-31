/**
 * Capacidades da plataforma — ÚNICO ponto que decide o que é exclusivo do app
 * desktop (Tauri) e o que roda no navegador.
 *
 * Detecção: `__TAURI_INTERNALS__` injetado pelo WebView do Tauri. Override de
 * build: `VITE_WEB_BUILD=1` força o modo web mesmo dentro de um WebView (útil
 * p/ testar a build web no app ou em CI).
 */

const forceWeb = ['1', 'true'].includes(String(import.meta.env.VITE_WEB_BUILD ?? '').toLowerCase())

export const isTauri = (): boolean =>
  !forceWeb && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface PlatformCaps {
  /** rodando no app desktop (Tauri) */
  native: boolean
  /** diálogos nativos de abrir/salvar + escrita direta em caminho absoluto */
  nativeFileDialogs: boolean
  /** lista de projetos recentes por caminho de arquivo */
  recentFiles: boolean
  /** projetos guardados no navegador (IndexedDB) com URL própria */
  browserProjects: boolean
  /** Copiloto via API da Anthropic (chave do usuário fica na máquina) */
  copilotAnthropic: boolean
  /** Copiloto com modelos locais (Ollama em localhost:11434) */
  copilotLocal: boolean
}

function detect(): PlatformCaps {
  const native = isTauri()
  return {
    native,
    nativeFileDialogs: native,
    recentFiles: native,
    browserProjects: !native,
    copilotAnthropic: native,
    copilotLocal: native,
  }
}

export const platform: PlatformCaps = detect()

/** algum provedor do Copiloto disponível nesta plataforma */
export const hasCopilot = (): boolean => platform.copilotAnthropic || platform.copilotLocal
