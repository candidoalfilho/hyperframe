import { analyze, type Project } from '@hyperframe/engine'

self.onmessage = (e: MessageEvent<Project>) => {
  try {
    const results = analyze(e.data)
    self.postMessage({ ok: true, results })
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
