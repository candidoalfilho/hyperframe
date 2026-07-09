# HyperFrame — Landing page

Página estática, 100% self-contained: um único `index.html` (CSS e JS inline, fontes de
sistema, ícones SVG inline) + as capturas de tela em `assets/`. Nenhum build step.

Para ver localmente: `npx serve site` (ou abra `site/index.html` direto no navegador).

## Deploy

### Vercel
1. `npm i -g vercel` e, dentro de `site/`, rode `vercel` (ou importe o repo em vercel.com).
2. Framework preset: **Other** · Build command: vazio · Output directory: `.` (ou `site` se importar o repo inteiro).
3. Cada `vercel --prod` publica; domínio custom em *Settings → Domains*.

### Netlify
1. Arraste a pasta `site/` em [app.netlify.com/drop](https://app.netlify.com/drop) — publicado em segundos.
2. Para deploy contínuo: conecte o repo, *Base directory* = `site`, sem build command, *Publish directory* = `site`.
3. Domínio custom em *Domain management* (HTTPS automático via Let's Encrypt).

### GitHub Pages
1. Suba o repo para o GitHub e vá em *Settings → Pages*.
2. Source: **Deploy from a branch** → branch `main`, pasta `/site` não é opção nativa; ou mova o conteúdo para `/docs` e selecione `/docs`, ou use uma Action (`actions/deploy-pages`) apontando para `site/`.
3. Publica em `usuario.github.io/hyperframe`; domínio custom via arquivo `CNAME` + DNS.

### Cloudflare Pages
1. Em *Workers & Pages → Create → Pages*, conecte o repo (ou use *Direct upload* da pasta `site/`).
2. Build command: vazio · *Build output directory*: `site`.
3. CDN global grátis, domínio custom no painel — bom para latência no Brasil.

## Ligando a lista de espera (formulário)

O form em `index.html` (seção `#lista`) já está pronto — só falta o endpoint:

- **Formspree** (recomendado, grátis até 50 envios/mês): crie um form em
  [formspree.io](https://formspree.io), copie o ID e substitua `SEU_ID` em
  `action="https://formspree.io/f/SEU_ID"`. Os e-mails chegam na sua caixa; o
  painel exporta CSV. Há um comentário HTML no próprio arquivo com o passo a passo.
- **Tally** (grátis, ilimitado): crie o form em [tally.so](https://tally.so) e troque o
  `<form>` por um link/botão para a URL do form (ou embede via iframe — nesse caso a
  página deixa de ser 100% sem terceiros).
- **Brevo** (se quiser já nutrir a lista com e-mail marketing): crie um formulário de
  inscrição em [brevo.com](https://www.brevo.com), aponte o `action` do form para a URL
  de subscribe gerada e mantenha o `name="email"`. A lista já fica pronta para as
  campanhas de lançamento.

Fallback: enquanto o endpoint não estiver ativo, o link `mailto:` abaixo do form
captura os interessados manualmente.

## Depois de publicar

- Troque `og:image` para a **URL absoluta** (ex.: `https://hyperframe.eng.br/assets/screenshot-modeling.png`) e adicione `og:url` — redes sociais não resolvem caminho relativo.
- Atualize o e-mail do `mailto:` se o domínio final for outro.

## Domínio

Sugestões (verificar disponibilidade no [registro.br](https://registro.br), ~R$ 40/ano):
**hyperframe.com.br** (comercial, mais memorável) e **hyperframe.eng.br** (restrito a
engenheiros/empresas de engenharia — reforça credibilidade no nicho). Ideal: registrar
os dois e apontar um para o outro. Registrar cedo — consta do plano de 90 dias no
`BUSINESS.md`, junto com INPI e CNPJ.
