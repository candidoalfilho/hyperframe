# HyperFrame — Plano de Negócio

> Software de análise e dimensionamento estrutural para o mercado brasileiro
> (ABNT NBR 6118 / 6120 / 6123 / 8681), multiplataforma (macOS + Windows + navegador).
> Pesquisa de mercado realizada em julho/2026 — preços confirmados nas páginas dos fornecedores.

> **⚠️ PIVÔ (15/07/2026): o HyperFrame é 100% OPEN SOURCE — sempre.** O site
> distribui binários por SO + código-fonte. Isso SUPERA o §4 (licenciamento
> Ed25519/checkout) e os planos com limites de recurso: código nunca é gate.
> Monetização compatível a definir: apoio (GitHub Sponsors/Pix), serviços
> (suporte, treinamento) e, no futuro, cloud opcional (colaboração/backup).
> Marca "HyperFrame" a registrar no INPI; licença de código a escolher
> (recomendação: AGPL-3.0 — MIT NÃO impede fork fechado/comercial).

---

## 1. A oportunidade

O mercado brasileiro de software estrutural é um **duopólio envelhecido**:

| | TQS | AltoQi Eberick |
|---|---|---|
| Fundação | 1986 | 1994 |
| Plataforma | **Somente Windows** | **Somente Windows** |
| Preço (anualizado) | R$ 2.700 – R$ 55.200 | R$ 2.874 – R$ 14.394 |
| Modelo | Assinatura mensal (IGP-DI anual) | Assinatura anual em 12× |
| Licença | "Licença Web" — exige **internet permanente** | Login cloud ou chave por máquina |
| Base ativa | ~90 dos 100 maiores escritórios (autodeclarado) | ~10-12 mil usuários ativos (autodeclarado) |

**Dores confirmadas (Reclame Aqui, fóruns, YouTube):**
1. **A ferida aberta da AltoQi**: encerrou upgrades e suporte das licenças vitalícias já vendidas, forçando migração para assinatura — clientes se sentem traídos.
2. Dificuldade de cancelamento, "venda casada" de módulos, bloqueios indevidos de licença.
3. Lentidão de processamento (Eberick) e curva de aprendizado íngreme + UI datada (TQS).
4. TQS exige conexão permanente — problema real em obra/interior.
5. **Zero suporte a macOS** — a edição estudante da TQS bloqueia até máquinas virtuais. Um Mac Apple Silicon não roda nada do mercado nacional.
6. Pirataria desenfreada (111 anúncios de "Eberick vitalício" a ~R$ 150 no Mercado Livre) — sinal de preço acima do que a cauda longa consegue pagar.

**Mercado:** ~370–400 mil engenheiros civis registrados no sistema Confea/CREA, ~35 mil novos por ano, estimadas 25–50 mil "cadeiras" pagantes de cálculo estrutural. Nenhuma startup brasileira de estrutural AI-native identificada até julho/2026 — **o slot está vazio**.

**Posicionamento do HyperFrame:** o primeiro software estrutural brasileiro
*multiplataforma, moderno, com preço honesto e IA nativa* — mirando a cauda longa
que a TQS ignora e que a AltoQi machucou: recém-formados, escritórios de 1–5 pessoas,
autônomos, professores e estudantes.

---

## 2. Produto e diferenciação

| Diferencial | Por quê importa |
|---|---|
| **macOS + Windows nativos** (Tauri) + demo no navegador | Único no mercado NBR. Macs dominam entre jovens engenheiros/arquitetos. |
| Motor próprio de pórtico espacial + normas NBR | Independência total de licenças de terceiros; roda offline. |
| UX moderna (2D/3D lado a lado, undo/redo, dark mode) | O contraste com TQS/Eberick é imediato em qualquer demo. |
| IA nativa (roadmap: lançamento por prompt, revisão automática de modelo, memorial gerado) | Incumbentes só têm IA "colada por fora" (docs/scripts). |
| Preço 40–50% abaixo do Eberick + estudante grátis | Ataca a pirataria pelo bolso e cria o funil de gerações novas. |
| **Promessa anti-vitalícia**: cancelou, mantém a última versão paga (sem updates) | Neutraliza exatamente o trauma que a AltoQi criou. Custo ~zero. |

---

## 3. Preços (lançamento)

Âncoras confirmadas (jul/2026, anualizado): Eberick Professional **R$ 2.874** /
Premium **R$ 5.754** / Enterprise **R$ 9.594** / Infinity **R$ 14.394**;
TQS EPP **R$ 5.040** / Unipro12 **R$ 12.540** / Pleno **R$ 27.600**.

| Plano | Limites e módulos | Preço | vs. concorrente |
|---|---|---|---|
| **Estudante** | Grátis. Até 4 pavimentos, marca d'água "USO ACADÊMICO", salva projeto (Eberick Demo não salva!), roda em Mac | **R$ 0** | único que salva + Mac |
| **Start** | Até 5 pavimentos / 2.000 m². Concreto armado completo (vigas, pilares, lajes), vento, γz, relatórios, IFC (roadmap) | **12× R$ 129** (R$ 1.548/ano) ou R$ 159/mês | −46% vs Eberick Professional |
| **Pro** | Até 15 pavimentos. + detalhamento/pranchas DXF, fundações, núcleo rígido (roadmap conforme entregas) | **12× R$ 249** (R$ 2.988/ano) ou R$ 299/mês | −48% vs Eberick Premium |
| **Studio** | Ilimitado + multi-assento (3 seats), API/automação, suporte prioritário | **12× R$ 479** (R$ 5.748/ano) ou R$ 579/mês | −40% vs Enterprise |

Mecânica comercial (norma do mercado, confirmada):
- Preço sempre exibido como **"12× de R$ X"**; **10% de desconto à vista no Pix**.
- Meios: cartão recorrente + **Pix Automático** (BC, 2025) + boleto anual. Gateway: **Stripe** (dev-first, Pix/boleto nativos) ou **Pagar.me/Vindi** se a negociação de taxa valer; Mercado Pago como alternativa.
- Trial Pro de 30 dias sem cartão. Cancelamento **self-service de 1 clique** (arma contra o Reclame Aqui da AltoQi).
- Tabela reajustada 1×/ano (IPCA), nunca mid-contract.

**Metas de receita (cenário conservador):**
- Ano 1: 150 assinantes pagos (mix 70% Start / 25% Pro / 5% Studio) ≈ **R$ 290 mil ARR**
- Ano 2: 600 assinantes ≈ R$ 1,2 mi ARR
- Break-even pessoal com ~40–60 assinantes Start (operação solo, custos < R$ 2 mil/mês).

---

## 4. Licenciamento e antipirataria

Estratégia em camadas — pragmática, não paranoica:

1. **Login cloud com flutuação por dispositivo** (estilo Eberick, que os usuários aceitam): a licença segue a conta; logout em uma máquina libera outra. **Graça offline de 30 dias** — jamais o "internet permanente" da TQS.
2. **Núcleo nativo**: o shell Tauri é binário compilado; na fase Rust do solver (roadmap), o motor de cálculo vira código nativo — ordens de magnitude mais difícil de crackear que Electron/asar.
3. Licença assinada **Ed25519**: arquivo de licença assinado no servidor, verificado localmente (chave pública embutida). Device fingerprint suave (hash de hardware) só para telemetria de abuso, não para bloquear.
4. **Preço + conveniência > pirataria**: a R$ 129/mês com updates mensais, memorial assinável e suporte via WhatsApp, o crack (que assusta justamente quem assina ART) perde a graça. O fórum já ensina: trabalho com ART exige licença legítima.
5. Marca d'água nos relatórios da versão estudante; verificação de licença nos PDFs gerados (QR de autenticidade — recurso de venda, não de trava).
6. Monitorar Mercado Livre/YouTube e derrubar anúncios por violação de marca (denúncia padrão).

O que **não** fazer: dongle físico, bloqueio de VM, internet obrigatória, punir cliente pagante.

---

## 5. Go-to-market

**Fase beta (3–4 meses):**
- 10–15 engenheiros calculistas convidados (1 ano grátis) → laudos de validação comparando com Eberick/TQS/Ftool em edifícios reais + depoimentos.
- Parceria com 2–3 professores de estruturas (UFPB, UFSC, USP…) — versão Estudante em sala de aula é o cavalo de troia: **35 mil formandos/ano**.

**Lançamento:**
- **YouTube é o canal rei** do nicho (a audiência já aprende TQS/Eberick lá): série "do zero ao memorial" + comparativos honestos "HyperFrame vs Eberick: mesmo edifício, lado a lado".
- Instagram/TikTok de engenharia civil (recortes de 60 s da análise 3D rodando **num MacBook** — isso por si só é conteúdo viral no nicho).
- SEO: "γz como calcular", "vento NBR 6123 exemplo", "quanto custa TQS/Eberick" — calculadoras grátis no site como iscas.
- Comunidade WhatsApp/Discord de beta users; suporte via WhatsApp (indispensável em B2B BR).
- Presença em eventos: Concrete Show, congressos ABECE/IBRACON (ano 2, quando houver caixa).

**Náufragos da AltoQi**: campanha direta "trouxe sua vitalícia? 50% no 1º ano" — o Reclame Aqui é uma lista de leads públicos.

---

## 6. Jurídico e responsabilidade

- **O software não assume responsabilidade técnica**: quem assina o projeto (ART/CREA) é o engenheiro. EULA explícita nisso, como TQS/Eberick fazem. Ainda assim: suite de validação pública (VALIDATION.md) e changelog de correções de cálculo — transparência vira confiança, e confiança é o produto.
- Estrutura: MEI não comporta (limite de receita) → **LTDA no Simples Nacional**, CNAE de licenciamento de software (62.03). Emissão de NFS-e automatizada (ENotas/Focus).
- LGPD: dados mínimos (e-mail, licença, telemetria opt-in). Projetos ficam na máquina do usuário (argumento de venda: "seu projeto não sobe pra nuvem sem você mandar").
- Marca: registrar **HyperFrame** no INPI (classe 9/42) cedo — verificar colisões antes do lançamento público (há usos de "Hyperframe" em outros nichos no exterior; no Brasil/classe de software estrutural o caminho parece livre, mas exige busca formal no INPI).

---

## 7. Riscos principais

| Risco | Mitigação |
|---|---|
| Erro de cálculo em produção → dano reputacional fatal | Suite de validação pública, beta longo com calculistas, disclaimers, seguro E&O quando houver receita |
| Incumbentes baixarem preço | Improvável (canibaliza base); nossa estrutura de custo (solo+IA) aguenta guerra de preço |
| Adoção lenta (engenheiro é conservador) | Estudante grátis + professores = adoção geracional; não depender de converter usuários TQS no ano 1 |
| Escopo infinito (paridade com 40 anos de TQS) | Roadmap disciplinado: dominar o edifício de concreto armado 4–15 pav. antes de qualquer outra coisa |
| Solo founder | IA como alavanca (este repo nasceu em 1 dia); documentação e testes desde o dia 0 |

---

## 8. Próximos passos comerciais (90 dias)

1. Semana 1–2: registrar domínio (hyperframe.eng.br / .com.br), INPI, CNPJ LTDA.
2. Semana 2–6: fechar o MVP técnico do roadmap v0.2 (detalhamento DXF + memorial completo). ✅ *(v0.2 técnico entregue)*
3. Semana 4–8: recrutar 10 beta users (grupos de calculistas no WhatsApp/Telegram, ABECE jr, professores).
4. Semana 8–12: landing page com lista de espera *(pronta em `site/`)* + 3 vídeos YouTube; instrumentar telemetria de uso.
5. Dia 90: decisão go/no-go do lançamento pago com dados do beta.

---

## 9. Playbook de venda — do zero à primeira receita

> O objetivo é vender a **primeira licença com o mínimo de infraestrutura possível** e
> só automatizar o que doer. Cada etapa abaixo é executável em dias, não meses.

### Etapa 0 — Infra mínima (1 dia)
- Publicar `site/` (Vercel/Cloudflare Pages — instruções em `site/README.md`), ligar o
  formulário de lista de espera (Formspree grátis até 50 envios/mês; depois Brevo).
- Domínio: registro.br (`hyperframe.com.br`, ~R$ 40/ano). E-mail: `contato@` via
  Cloudflare Email Routing (grátis) → seu Gmail.
- WhatsApp Business com o número comercial — no Brasil B2B de engenharia, **o funil é
  o WhatsApp**; o site existe para gerar a conversa.

### Etapa 1 — Vender ANTES de automatizar (primeiras 10 vendas)
- **Checkout sem código**: Stripe Payment Links ou Mercado Pago link de pagamento
  (Pix/boleto/cartão em 12×). Um link por plano. Nota fiscal via eNotas/NFE.io (Simples).
- **Entrega da licença manualmente**: gere um arquivo de licença assinado (script
  Ed25519 de 30 linhas — chave privada sua, pública embutida no app) e mande por
  e-mail/WhatsApp. Com < 50 clientes, isso custa minutos por venda e permite conversar
  com CADA cliente — o insight vale mais que a automação.
- Preço de fundador: 40% off vitalício no preço (não no produto) p/ os 20 primeiros
  ("early believers") — cria urgência e perdoa a imaturidade do produto.

### Etapa 2 — Máquina de demanda (contínuo)
Canais em ordem de ROI esperado p/ este nicho:
1. **YouTube** (o canal decide o jogo): série semanal "Calculando um prédio real do
   zero no HyperFrame" + comparativos "mesmo edifício no Eberick vs HyperFrame".
   Título honesto, tela gravada, sem produção cara.
2. **Instagram/TikTok reels**: 30–60 s — o 3D girando NUM MACBOOK, γz aparecendo,
   pranchas saindo. O nicho compartilha ferramenta nova como fofoca.
3. **Professores**: 10 e-mails por semana p/ professores de concreto/estruturas
   (currículo Lattes é público) oferecendo a versão Estudante + material de aula
   pronto (projeto exemplo + roteiro). Cada professor = 40-80 alunos/semestre.
4. **Comunidades**: grupos de Telegram/WhatsApp/Facebook de calculistas e do CREA
   estadual; responder dúvidas de norma COM prints do software (ajudar > anunciar).
5. **SEO técnico**: os posts que os engenheiros pesquisam ("como calcular γz",
   "vento NBR 6123 passo a passo", "quanto custa TQS") com calculadoras embutidas.
6. Depois de 50 clientes: caso de sucesso em PDF + palestra em IBRACON/ABECE.

### Etapa 3 — Automatizar a operação (após ~30 clientes)
- Portal do assinante (Next.js + Stripe Billing/Pagar.me): cadastro → pagamento →
  licença emitida automaticamente → download. Pix Automático quando disponível no PSP.
- Servidor de licenças: endpoint que assina/renova licenças (Cloudflare Workers basta),
  flutuação por dispositivo + graça offline 30 dias (BUSINESS §4).
- Suporte: WhatsApp (Zapdesk/manual) + docs públicas (Docusaurus/Mintlify) + Discord.
- Métricas mínimas: MRR, churn, ativação (rodou 1ª análise), NPS trimestral.

### Etapa 4 — Fortalecer o moat
- Publicar `validation/` (VALIDATION.md) com comparativos vs Ftool/Eberick — vira
  argumento de venda único ("o único que mostra a validação").
- Programa de indicação: 1 mês grátis p/ cada assinante indicado (B2B de nicho:
  indicação é o canal nº 1 no longo prazo).
- Parceria com cursos de pós/especialização em estruturas (licença educacional).

### Metas de sanidade (checkpoints)
| Marco | Sinal de que está funcionando |
|---|---|
| 30 dias de site no ar | ≥ 150 e-mails na lista de espera |
| Beta (10-15 calculistas) | ≥ 5 usam semanalmente sem você cutucar |
| 90 dias pós-lançamento | ≥ 25 assinantes pagos (≈ R$ 4-6 mil MRR) |
| 12 meses | 150 assinantes, churn < 3%/mês, 1 caso público |

Se um marco falhar: conversar com 10 usuários antes de mexer em produto ou preço.
