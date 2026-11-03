import { platform } from './platform'

/**
 * Telemetria ANÔNIMA e opcional (Aptabase): um único evento por abertura do
 * app, com versão e SO — nunca projetos, nomes de arquivo ou dados pessoais.
 * Só existe no desktop (a chave fica no binário, ver src-tauri/src/main.rs);
 * sem chave no build ou com o usuário desativado, nada é enviado.
 */

const OPTOUT_KEY = 'hyperframe-telemetry' // '0' = desativada
const NOTICE_KEY = 'hyperframe-telemetry-notice' // '1' = aviso já visto

export function telemetryEnabled(): boolean {
  try {
    return localStorage.getItem(OPTOUT_KEY) !== '0'
  } catch {
    return false
  }
}

export function setTelemetryEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(OPTOUT_KEY)
    else localStorage.setItem(OPTOUT_KEY, '0')
  } catch {
    // ignora
  }
}

export function telemetryNoticeSeen(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1'
  } catch {
    return true // sem localStorage não há como não repetir o aviso — omite
  }
}

export function markTelemetryNoticeSeen(): void {
  try {
    localStorage.setItem(NOTICE_KEY, '1')
  } catch {
    // ignora
  }
}

/** ping de abertura — falha em silêncio (offline, plugin ausente, opt-out) */
export async function trackAppOpened(): Promise<void> {
  if (!platform.native || !telemetryEnabled()) return
  try {
    const { trackEvent } = await import('@aptabase/tauri')
    await trackEvent('app_opened')
  } catch {
    // build sem chave ou sem rede: segue a vida
  }
}
