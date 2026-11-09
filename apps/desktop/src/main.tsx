import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { NamePromptHost } from './web/NamePrompt'
import { useStore } from './store'
import './theme.css'

// hook de desenvolvimento: store acessível p/ verificação automatizada (Playwright)
if (import.meta.env.DEV) {
  ;(window as unknown as { __hfStore: typeof useStore }).__hfStore = useStore
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <NamePromptHost />
  </React.StrictMode>,
)
