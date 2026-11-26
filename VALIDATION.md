# HyperFrame — Política de Validação

Software estrutural só tem valor se merecer confiança. Este documento define como o
HyperFrame é validado — e o que ainda falta antes de uso em projeto real.

## Estado atual (v0.2.3)

### Validação automatizada (roda em `npm test` — 266 testes)

**Âncoras analíticas (soluções fechadas):**
- Matriz de rigidez local 12×12: simetria, termos EA/L e 12EI/L³
- Viga biengastada sob carga uniforme: M_apoio = −wL²/12, M_meio = +wL²/24, V = ±wL/2
- Solver skyline LDLᵀ: solução exata de sistema 3×3 conhecido; sistema SPD aleatório 40×40 verificado por resíduo A·x−b ≈ 0; detecção de matriz singular
- Seção retangular: A, Iy, Iz, J (Saint-Venant)

**Normas (valores calculados à mão, NBR):**
- NBR 6118 materiais: fcd, fctm, fctk,inf, fctd, Eci, αi, Ecs p/ C30 granito
- Flexão: caso clássico Md=100 kN·m, 20×50 C25 → As = 5,61 cm², x/d = 0,223
- Cisalhamento: VRd2 = 390,5 kN, Vc = 69,3 kN, Asw/s = 2,88 cm²/m (modelo I)
- Vento NBR 6123: S2 (cat. IV, classe B, z=23 m) = 0,924; q = 0,838 kPa
- γz: 1,087 (nós fixos) / 1,176 (nós móveis); combinações: 13 ELU + 6 ELS

**Propriedades físicas globais (o teste mais forte):**
- ΣFz das reações = peso total aplicado (G, Q e ELU 1,4·(G+Q)) — fecha em 0,1%
- ΣFx das reações = −força total de vento aplicada
- Diafragma rígido: nós do pavimento transladam identicamente (variância < 1e-9)
- Simetria: estrutura simétrica → reações simétricas
- Deslocamento lateral monotônico com a altura
- Edifício de 8 pavimentos: γz ∈ [1,0; 1,5], taxas de aço ∈ [40; 250] kg/m³

**Dimensionamento v0.2 (âncoras adicionais):**
- Pilares: NRd de compressão centrada = 0,85·fcd·(Ac−As) + 420 MPa·As (fórmula fechada);
  curva de interação simétrica p/ seção simétrica; utilização radial linear no momento;
  λ, λ1, αb e momento mínimo por fórmulas (§15.8/§11.3.3.4.3); ρ ∈ [0,4%; 4%] no exemplo
- Lajes (Marcus): laje quadrada biapoiada → quinhão w/2 por direção (caso clássico);
  quinhões conservam a carga total; As ≥ 0,67·ρmin
- Sapatas: σ ≤ σadm em todas; a−b acompanha o pilar; h ≥ (a−ap)/3
- Flechas: fator de fissuração ≥ 1; vigas 20×50 do exemplo ≤ L/250
- Regiões de carga (escada/reservatório): força conservada na distribuição às lajes,
  refletida nos pesos de pavimento (γz) e nas reações
- DXF: roundtrip write→parse preserva entidades; blocos/INSERT com rotação/escala

**Módulos v0.2.1 (paridade com o tour do TQS — âncoras à mão):**
- Desaprumo (§11.3.3.4.1): θ1 com clamps 1/300–1/200; θa p/ n prumadas; forças por nível;
  regra vento×desaprumo pelos momentos de tombamento (3 ramos testados)
- 2ª ordem 0,95·γz (§15.7.2): fator aplicado só p/ 1,1 < γz ≤ 1,3; consistência
  fator↔γz↔rótulos de combinação no edifício exemplo
- Torção (§17.5): he/Ae/TRd2/A90-s/ΔAsl p/ 20×50 C25 (Td = 10 kN·m); interação
  Vd/VRd2 + Td/TRd2; limiar de torção de compatibilidade desprezível
- Fissuração ELS-W (§17.3.3.2): LN estádio II, σs, w1/w2/wk p/ caso de referência;
  limites tab. 13.4 por CAA
- Escadas: cargas do lance inclinado (25·t/cosθ + degraus), Md = wL²/8, As, flecha com
  Branson, fórmula de Blondel
- Reservatórios: M = γw·hw³/6 na parede, estanqueidade wk ≤ 0,2 mm com iteração de As,
  fundo engastado c/ coluna d'água, volume/peso em operação
- Incêndio (NBR 14432/15200): TRRF por grupo×altura; tabelas 4/5 (vigas) e 6/7 (lajes)
  transcritas e testadas ponto a ponto c/ interpolação; pilares pelo método analítico
  (TRF = 120·(ΣR/120)^1,8) c/ âncora fechada
- Blocos sobre estacas (Blévot): d p/ α∈[45°,55°], tirantes 2/3/4/5 estacas, tensões nas
  bielas vs limites 1,4/1,75/2,1·KR·fcd, capacidade da estaca c/ peso do bloco
- Memorial PDF: writer validado estruturalmente (xref aponta p/ cada objeto, startxref,
  %%EOF), WinAnsi/escapes de acentos, transliteração de símbolos, presença das 15 seções
  e dos dados de dimensionamento no texto (streams sem compressão — pesquisável)
- Furos/aberturas de laje: desconto exato de g/q na interseção (âncoras fechadas com a
  escada do exemplo: Δg = 17,64 kN, Δq = 5,88 kN), recorte dos polígonos pelo contorno
  da laje, escada com/sem furo, nota de reforço de borda no dimensionamento

**Módulos v0.2.2 (paridade com o TQS Passo-a-Passo — âncoras à mão):**
- Seções de pilar: círculo com A/I/J exatos (πd²/4, πd⁴/64, πd⁴/32) e polígono de 48
  lados conservador em área (< 0,3%); L 50×50 t20/20 com centróide/inércias compostas
  (A = 0,16 m², I = 3,1271e-3 m⁴) e J de paredes finas; contorno recuado retilíneo;
  esmagamento centrado do círculo por fórmula fechada; curva de interação ~radial;
  rotação 0/90/180/270 nos eixos locais (yL/zL) e na caixa envolvente
- Furos de viga (§13.2.5): as 4 condições de dispensa testadas isoladamente (face,
  12 cm/h·⅓, apoio 2h, vizinho 2h) + limite h/3 governando em viga baixa + posição
  relativa a pilares no projeto exemplo
- Seção variável por trecho: corte do vão de dimensionamento na mudança de seção
  (com e sem override), seções corretas por barra do pórtico
- Carga de parede parcial: força total conservada (trecho = metade → 50% da carga)
- Borda livre de laje: quinhões redistribuídos conservam TODA a carga (g e q) nas
  3 vigas restantes; aviso de redistribuição emitido
- Geotecnia: Es = α·K·NSPT (areia N20 → 54 MPa; argila N10 → 14 MPa); média ponderada
  por camadas; Aoki–Velloso com âncora integral à mão (hélice ø40, L=10 m, 2 camadas:
  fuste por camada + ponta + FS 2); mola de sapata kv = A·Es/(B(1−ν²)·0,88) exata;
  layouts de 1–5 estacas (braços e Σkv)
- Apoios elásticos no solver: recalque = N/kv exato (mola vertical isolada) e reação
  recuperada; interação solo-estrutura de ponta a ponta no edifício exemplo
  (molas em todos os pilares, recalques em mm, ΣFz = peso total preservado)
- Consistência: modelo saudável sem graves; sem pilares/pilares sobrepostos/viga sem
  apoio/furo ≥ altura/pilar no ar → apontamentos com severidade correta
- Desenhos novos: corte esquemático (níveis, pilares do alinhamento, vigas seccionadas
  com seção, cotas de pé-direito), planta de cargas (G/Q/ELU por pilar + tabela),
  prancha A0–A4 com moldura/carimbo (dimensões exatas do papel, escala automática
  padronizada, conteúdo dentro da moldura, campos preenchidos)

**Módulos v0.2.3 (fatia CypeCAD — âncoras à mão):**
- Nervuradas: fração de nervuras bw(2s−bw)/s² e peso próprio fechado (h25/capa5/bw10/s50
  → 0,122 m³/m² = 3,05 kN/m²); enchimento somando o volume real; checagens §13.2.4.2
  (nervura ≥ 5, capa ≥ max(4; l0/15)); VRd1 de laje (§19.4.1) por fórmula; momento por
  nervura = Marcus × espaçamento (âncora fechada na laje 5×5); bloco na capa; dispensa
  de estribo; unidirecional carrega só a direção das nervuras; análise completa do
  edifício exemplo com todas as lajes nervuradas
- Tubulões: fuste mínimo 0,70 m e por tensão do concreto (√(4N/πσ)); base por σadm com
  arredondamento de 5 cm; rasante 60° fechada; alerta p/ base > 1,80 m; análise completa
  + molas de ISS pela base equivalente
- Punção §19.5: u0/u1 (ret. e circular), τSd nos contornos, τRd2 = 0,27·αv·fcd e
  τRd1 = 0,13(1+√(20/d))(100ρfck)^{1/3} — âncora integral à mão (pilar 40×40, d=16:
  τRd1 = 794 kPa < τSd1 = 1384 kPa ⇒ exige armadura)
- Consistência: pilar interno à laje sem viga (laje lisa não modelada) e pilar-parede
  (b/h ≥ 5) apontados
- Memorial detalhado (v0.2.61): a conta escrita As = Md/(fyd·z), z = d − 0,4x reproduz a
  armadura calculada de cada apoio de viga do edifício de exemplo; a combinação apontada em
  cada diagrama reproduz o valor extremo da envoltória; a tabela de cargas de cada viga
  fecha com a soma das reações; a descida de cargas de cada pilar termina na reação da
  planta de cargas
- Cotas do usuário (v0.2.60): linear horizontal entre (1;2) e (5;3) mede Δx = 4,00 m com a
  linha em y = 1; alinhada no triângulo 3-4-5 mede 5,00 m com a linha a 1 m na normal;
  cadeia 0–4–8,5–12,5 m ⇒ 400 · 450 · 400 e total 1250 cm; acumulada ⇒ 0 · 400 · 850 · 1250;
  pilar movido 35 cm ⇒ cota +35 cm; pilar 10 cm mais largo dos dois lados ⇒ vão livre
  −10 cm; cotagem automática de 12 pilares ⇒ 4 alinhamentos em X; os mesmos números saem
  na planta de forma e no DXF
- Caminho das cargas (v0.2.59): painel isolado de 4 × 6 m (laje h = 12, g = 4 kN/m²,
  vigas 15×40, pilares 20×20) — quinhões de 4 m² (triângulos) e 8 m² (trapézios) ⇒ 16 e
  32 kN por borda; vigas 22 e 41 kN, metade para cada pilar; 31,5 kN das vigas + 3 kN de
  peso próprio = 34,5 kN por fundação (tudo à mão); viga secundária de 36 kN entrega 18 kN
  a cada principal; em todos os casos e combinações do edifício de exemplo: equilíbrio em
  cada nó (< 10⁻⁶), próprio + recebido = entregue em cada viga, e a soma das fundações
  igual à carga aplicada e à planta de cargas
- Cargas concentradas e lineares sobre lajes (v0.2.58): grelha com força central em
  placa quadrada apoiada — Σ reações = P e flecha 0,0116·P·a²/D (Timoshenko, ±12% da
  analogia); faixa unidirecional com linha a 1/4 do vão — reações 3/4 e 1/4 (estática,
  exato); pórtico de 1 painel — a força chega inteira aos pilares, 1/4 em cada um com a
  carga no centro; treliçada — alavanca 18/6 kN p/ 24 kN a 1 m do apoio em vão de 4 m;
  punção sob carga pontual: u1 = 2(bx+by) + 4πd e τSd = FSd/(u1·d) fechados à mão;
  vigota com parede de 6 kN/m em 3,6 m: M = 10,8·2 − 6·1,8·0,9 = 11,88 kN·m
- Ligação viga–pilar com braço rígido (§14.6.2.1, v0.2.57): movimento de corpo rígido
  dos nós não gera esforço no elemento com offsets (transformação H correta); pórtico
  de 1 vão com viga a 15 cm do eixo dos pilares — parede 10 kN/m × 5 m ⇒ 25 kN por
  pilar e momento 25 × 0,15 = 3,75 kN·m na base (âncora à mão); equilíbrio global de
  momentos com as cargas na posição real; trechos rígidos: pilar t = 50 cm, viga
  h = 40 cm ⇒ ℓef = 4,50 + 2 × 0,12 = 4,74 m (§14.6.2.4), com a força vertical conservada

### Versão web (navegador)

A versão web usa o MESMO engine e o mesmo app; muda só o armazenamento (IndexedDB do
navegador em vez de arquivos) e as funções exclusivas do desktop (`src/platform.ts`).
Os resultados de cálculo são, portanto, os mesmos do desktop. Testes próprios em
`apps/desktop/test/web-*.test.ts` (vitest + fake-indexeddb): rotas, gravação e
revisões (duas abas não se sobrescrevem), importação validada, navegador sem
IndexedDB e UUID sem `crypto.randomUUID`.

### O que os testes NÃO cobrem ainda

- Comparação independente com outro software (Ftool, Eberick, SAP2000)
- Cargas trapezoidais exatas de laje (usamos uniforme equivalente por quinhão)
- Efeitos que o v0.1 não modela (ver ROADMAP: dívidas técnicas)
- Escadas: patamares/apoios reais (lance tratado biapoiado no vão em planta — conservador)
- Reservatórios: placas com tabelas exatas (paredes em balanço na base — conservador);
  empuxo de terra em reservatórios enterrados não modelado
- Incêndio: TRRF automático usa a tab. A.1 genérica — isenções e divisões de ocupação
  específicas exigem confirmação manual; lajes lisas/nervuradas fora do escopo
- Interação solo-estrutura: correlações empíricas (Teixeira & Godoy, Aoki–Velloso) com
  UMA sondagem p/ todo o terreno; CRH por fator prático (0,5·CRV editável); molas de
  estaca sem transferência de carga por camada — recalques são ESTIMATIVAS de análise,
  não previsão geotécnica (NBR 6122 exige laudo)
- Furos de viga: verificada a DISPENSA (§13.2.5.2); a verificação da região não
  dispensada (bielas/tirantes, Vierendeel) é do engenheiro

## Plano de validação v0.2 (pré-beta) — **bloqueante para uso comercial**

1. **5 edifícios-referência** (2, 4, 8, 12, 15 pavimentos; plantas assimétricas incluídas):
   - Pórtico plano equivalente → **Ftool** (grátis, referência acadêmica nacional): momentos e flechas por barra, diferença alvo < 2%
   - Modelo completo → **Eberick/TQS estudante**: reações, γz, As de vigas, diferença alvo < 10% (métodos diferem)
   - Vento: planilhas consagradas de NBR 6123 (diferença < 1% em q(z); Ca comparado à figura da norma)
2. **Exemplos de literatura**: reproduzir exemplos numéricos de livros-texto consagrados de concreto armado e estabilidade global (γz) e de apostilas universitárias públicas
3. Publicar `validation/` no repositório com os modelos, resultados lado a lado e desvios — **transparência é o argumento de venda**

## Princípios permanentes

- Nenhum PR toca `packages/engine/src/analysis` ou `src/nbr` sem teste novo ou atualizado
- Toda correção de cálculo gera entrada no CHANGELOG com número da versão afetada
- O relatório impresso sempre declara versão do software e avisos ativos do modelo
- O software **não substitui o engenheiro responsável**: quem assina ART responde pelo projeto; o EULA e o relatório deixam isso explícito
