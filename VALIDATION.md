# HyperFrame — Política de Validação

Software estrutural só tem valor se merecer confiança. Este documento define como o
HyperFrame é validado — e o que ainda falta antes de uso em projeto real.

## Estado atual (v0.1)

### Validação automatizada (roda em `npm test` — 80 testes)

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

### O que os testes NÃO cobrem ainda

- Comparação independente com outro software (Ftool, Eberick, SAP2000)
- Cargas trapezoidais exatas de laje (usamos uniforme equivalente por quinhão)
- Efeitos que o v0.1 não modela (ver ROADMAP: dívidas técnicas)

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
