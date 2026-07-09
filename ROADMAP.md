# HyperFrame — Roadmap

> Norte: dominar **o edifício de concreto armado de 4–15 pavimentos** de ponta a ponta
> antes de expandir para qualquer outra tipologia. Cada fase termina em algo demonstrável.

## v0.1 — Fundação técnica ✅ (hoje)

- [x] Monorepo (engine TypeScript puro + app Tauri/React/Three.js)
- [x] Modelagem 2D em planta: eixos, pilares, vigas (polilinha), lajes (detecção automática de contorno), cargas de parede
- [x] Visualização 3D com seleção sincronizada, isolamento de pavimento
- [x] Pórtico espacial (6 GDL/nó) com diafragma rígido mestre-escravo, solver skyline LDLᵀ próprio
- [x] Cargas: peso próprio, revestimento/sobrecarga NBR 6120 (quinhões 45°), alvenaria, vento NBR 6123 (S1/S2/S3, Ca)
- [x] Combinações NBR 8681 (13 ELU + 6 ELS), dois passes de rigidez (§15.7.3)
- [x] Estabilidade global: γz, α, deslocamentos limites (tab. 13.3)
- [x] Dimensionamento de vigas NBR 6118 (flexão + cisalhamento modelo I, escolha de barras)
- [x] Verificação simplificada de pilares, quantitativos, relatório imprimível
- [x] 80 testes automatizados (âncoras analíticas + equilíbrio global)

## v0.2 — Confiabilidade e detalhamento ✅ (núcleo entregue)

- [x] Dimensionamento completo de **pilares**: flexo-compressão oblíqua (curva de interação por integração da seção com bloco retangular + domínios), pilar-padrão com curvatura aproximada, αb por momentos de extremidade, momentos mínimos (§11.3.3.4.3), escolha automática de arranjo (4–20 barras, ρ 0,4–4%)
- [x] Dimensionamento de **lajes maciças** (Marcus sem redução por torção, condições de contorno automáticas por continuidade) + flechas com Branson + fluência (αf=1,32)
- [x] Flechas de vigas ELS (elástica do pórtico via Hermite + Branson + diferida) com limite L/250
- [x] Fundações: reações de serviço → **sapatas rígidas** (bielas/CG, núcleo central, presets de solo) — orientativo, exige SPT
- [x] **Detalhamento preliminar** (posições, estribos, ancoragens NBR §9.4) + tabela de aço por bitola
- [x] **Pranchas**: planta de forma, armação de vigas e seções de pilares — SVG no app + exportação **DXF** (writer R12 próprio)
- [x] **Importação DXF** como underlay do editor (parser próprio com blocos/INSERT) p/ modelar sobre a arquitetura
- [x] **Múltiplas plantas de forma** (térreo ≠ tipo ≠ cobertura) com gerenciador
- [x] Regiões de carga: **escadas e reservatório/caixa d'água** (distribuição às lajes por interseção de polígonos)
- [ ] **Validação cruzada** (ver VALIDATION.md): 5 edifícios-referência vs Ftool/Eberick/planilhas → publicar relatório — **bloqueante p/ venda**
- [ ] Diagramas 2D por barra no inspetor (M, V, N com valores)
- [ ] Memorial de cálculo completo em PDF (hoje: resumo imprimível)
- [ ] Salvar/abrir nativo (diálogos do SO via plugin Tauri) + autosave/recuperação
- [ ] Pé-direito variável por pavimento na UI (modelo já suporta)

## v0.3 — Beta fechado (2–3 meses)

- [ ] 10–15 calculistas convidados; telemetria de erros (opt-in) e feedback in-app
- [ ] Detalhamento de armaduras de vigas (desenho: barras, dobras, tabela de aço) → prancha DXF/PDF
- [ ] Importação de DXF de arquitetura como underlay do editor 2D
- [ ] Núcleo rígido / pilares-parede (elemento de casca simplificado ou pórtico equivalente)
- [ ] Torção de compatibilidade & redistribuição de momentos
- [ ] Excentricidade de vento (±7,5%) e desaprumo global (NBR 6118 §11.3.3.4.1)
- [ ] Performance: solver em **Rust/WASM** (mesma interface, 10–50× mais rápido, base da proteção anticópia)
- [ ] Instaladores assinados: notarização macOS (Apple Developer R$ 500/ano) + Authenticode Windows; CI GitHub Actions com matriz mac/win

## v1.0 — Lançamento comercial (6–9 meses)

- [ ] Licenciamento: conta cloud + ativação Ed25519 + graça offline 30 dias (ver BUSINESS.md §4)
- [ ] Site + checkout (Stripe/Pagar.me: Pix, boleto, cartão) + área do assinante
- [ ] Auto-update (plugin updater do Tauri)
- [ ] Versão Estudante (marca d'água, limite 4 pavimentos)
- [ ] Documentação pública + 10 vídeos tutoriais + 3 projetos-exemplo completos
- [ ] IFC import/export (OpenBIM) — paridade com o argumento BIM do Eberick

## v1.x — Expansão

- [ ] IA nativa: "lançar estrutura a partir da planta de arquitetura", crítica automática de modelo ("L3 sem apoio", "P12 esbelto"), memorial redigido por IA
- [ ] Protensão (lajes/vigas), pré-moldados, alvenaria estrutural (NBR 16868), aço (NBR 8800 — reaproveitar know-how do vigaframe/mixlab)
- [ ] Análise dinâmica (vento dinâmico NBR 6123, sismo NBR 15421)
- [ ] Interação solo-estrutura (molas de fundação — reaproveitar soloslab)
- [ ] Colaboração em nuvem (projetos compartilhados, versionamento)

## Dívidas técnicas conhecidas (v0.1)

| Item | Impacto | Plano |
|---|---|---|
| Ca do vento: grade aproximada da Fig. 4 | ±10% na força de vento; usuário pode sobrescrever | Digitalizar a figura da norma (v0.2) |
| Quinhões de laje: uniforme equivalente (não trapezoidal) | Momentos de viga ligeiramente suavizados | Cargas trapezoidais exatas (v0.2) |
| Lajes não entram na rigidez (só carga + diafragma) | Conservador p/ vigas | Grelha/casca opcional (v0.3) |
| Pilar: verificação simplificada (não dimensiona As definitivo) | Rotulado na UI | Flexo-compressão oblíqua (v0.2) |
| Vigas: sem flecha ELS, sem armadura de pele | Relatório indica | v0.2 |
| Apoios sempre engastados na fundação | Usual, mas não configurável | Molas/rotulado (v0.2) |
| V0 das cidades: aproximado das isopletas | Usuário confirma na UI | Mapa interativo (v0.3) |
