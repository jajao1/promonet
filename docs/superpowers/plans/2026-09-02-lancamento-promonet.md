# PromoNET Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lançar a estrutura mínima de aquisição da PromoNET, com identidade, seis grupos segmentados, página de entrada rastreável, calendário editorial e controles para validar o crescimento em 90 dias.

**Architecture:** A operação será documentada em arquivos Markdown e CSV, enquanto a página pública será um site estático sem backend. Links de entrada terão parâmetros de origem e serão registrados numa planilha CSV; eventos de clique serão preservados na URL de destino e poderão ser conectados posteriormente a uma ferramenta de analytics sem alterar o funil.

**Tech Stack:** HTML5, CSS3, JavaScript sem frameworks, Node.js para testes estruturais, Markdown e CSV para operação.

---

## Estrutura de arquivos

```text
PromoNET/
├── README.md
├── package.json
├── site/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── config.js
├── tests/
│   ├── site-structure.test.js
│   └── tracking.test.js
├── operations/
│   ├── brand-guide.md
│   ├── group-setup.md
│   ├── offer-checklist.md
│   ├── daily-routine.md
│   ├── editorial-calendar.csv
│   ├── content-templates.md
│   ├── partnerships.md
│   ├── paid-tests.md
│   └── metrics.csv
└── docs/superpowers/
    ├── specs/2026-09-02-divulgacao-grupos-afiliados-design.md
    └── plans/2026-09-02-lancamento-promonet.md
```

Cada arquivo possui uma única responsabilidade: o site capta e direciona, os testes validam o funil e a pasta `operations` reúne os procedimentos usados diariamente.

### Task 1: Preparar o repositório e o mapa do projeto

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `package.json`

- [ ] **Step 1: Inicializar o repositório**

Run: `git init`

Expected: saída contendo `Initialized empty Git repository`.

- [ ] **Step 2: Criar os arquivos básicos**

Criar `.gitignore`:

```gitignore
node_modules/
.DS_Store
Thumbs.db
*.log
```

Criar `package.json`:

```json
{
  "name": "promonet",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

Criar `README.md`:

```markdown
# PromoNET

Projeto de aquisição e operação de comunidades de ofertas nos nichos Tecnologia, Casa e Utilidades, e Moda e Beleza.

## Componentes

- `site/`: página pública para seleção do nicho e da plataforma;
- `operations/`: procedimentos, calendário e métricas;
- `tests/`: validações automatizadas da página e do rastreamento;
- `docs/superpowers/`: estratégia aprovada e plano de implementação.

## Validação

Execute `npm test` antes de publicar alterações no site.
```

- [ ] **Step 3: Verificar os arquivos**

Run: `git status --short`

Expected: `.gitignore`, `README.md`, `package.json` e `docs/` aparecem como arquivos novos.

- [ ] **Step 4: Commit**

```powershell
git add .gitignore README.md package.json docs
git commit -m "docs: initialize PromoNET launch project"
```

### Task 2: Definir identidade e configuração dos seis grupos

**Files:**
- Create: `operations/brand-guide.md`
- Create: `operations/group-setup.md`

- [ ] **Step 1: Criar o guia de marca**

Criar `operations/brand-guide.md` com:

```markdown
# Guia rápido da PromoNET

## Promessa

Ofertas verificadas para economizar tempo e dinheiro, sem spam e sem falsa urgência.

## Comunidades

- PromoNET Tech — eletrônicos, informática e acessórios;
- PromoNET Casa — cozinha, organização, móveis e utilidades;
- PromoNET Moda & Beleza — roupas, calçados, cosméticos e cuidados pessoais.

## Tom de voz

Direto, útil e transparente. Informar preço, loja, frete ou restrição relevante e validade conhecida. Não usar “imperdível” ou “menor preço da história” sem evidência.

## Identificação de afiliação

Usar no perfil e nas mensagens fixadas: “Alguns links são de afiliados. Podemos receber comissão sem custo adicional para você.”
```

- [ ] **Step 2: Criar as instruções dos grupos**

Criar `operations/group-setup.md` com nomes, descrições e mensagem fixada para WhatsApp e Telegram:

```markdown
# Configuração dos grupos

## Descrição padrão

Ofertas verificadas de {NICHO}. De 3 a 6 alertas por dia e um resumo quando houver boas oportunidades. Alguns links são de afiliados, sem custo adicional para o comprador. Não permitimos anúncios de membros.

## Boas-vindas

Bem-vindo à PromoNET {NICHO}! Aqui você recebe ofertas selecionadas, comparações e cupons. Confira preço final e frete antes de comprar, pois as condições podem mudar. Para reduzir notificações, silencie o grupo sem sair. Convide apenas pessoas interessadas neste nicho: {LINK_DO_GRUPO}.

## Regras

1. Somente administradores publicam;
2. Nenhum membro é adicionado sem consentimento;
3. Links de afiliados são identificados na descrição;
4. Ofertas expiradas são marcadas ou removidas quando possível;
5. Dados pessoais não são solicitados no grupo.

## Checklist manual de criação

- Criar PromoNET Tech no WhatsApp e no Telegram;
- Criar PromoNET Casa no WhatsApp e no Telegram;
- Criar PromoNET Moda & Beleza no WhatsApp e no Telegram;
- Aplicar descrição, imagem e mensagem fixada;
- Restringir publicações aos administradores;
- Copiar os seis links de convite para `site/config.js`.
```

- [ ] **Step 3: Revisar presença dos elementos obrigatórios**

Run: `rg -n "afiliados|consentimento|Tech|Casa|Moda" operations`

Expected: ocorrências nos dois arquivos, incluindo os três nichos e os avisos de transparência.

- [ ] **Step 4: Commit**

```powershell
git add operations/brand-guide.md operations/group-setup.md
git commit -m "docs: define brand and group setup"
```

### Task 3: Criar os testes estruturais da página de entrada

**Files:**
- Create: `tests/site-structure.test.js`
- Create: `site/index.html`

- [ ] **Step 1: Escrever o teste que exige três nichos e seis destinos**

Criar `tests/site-structure.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('landing page exposes three niche cards and six channel buttons', () => {
  const html = fs.readFileSync('site/index.html', 'utf8');
  assert.equal((html.match(/class="niche-card"/g) || []).length, 3);
  assert.equal((html.match(/data-channel=/g) || []).length, 6);
  for (const niche of ['tech', 'casa', 'moda-beleza']) {
    assert.match(html, new RegExp(`data-niche="${niche}"`));
  }
});

test('landing page discloses affiliate relationship', () => {
  const html = fs.readFileSync('site/index.html', 'utf8');
  assert.match(html, /links de afiliados/i);
});
```

- [ ] **Step 2: Criar um HTML mínimo para provocar a falha correta**

Criar `site/index.html`:

```html
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>PromoNET</title></head><body></body></html>
```

- [ ] **Step 3: Executar os testes**

Run: `npm test`

Expected: 2 testes falham por ausência dos cartões e do aviso de afiliação.

- [ ] **Step 4: Commit dos testes em falha**

```powershell
git add tests/site-structure.test.js site/index.html
git commit -m "test: define landing page structure"
```

### Task 4: Implementar a página de seleção responsiva

**Files:**
- Modify: `site/index.html`
- Create: `site/styles.css`
- Create: `site/config.js`
- Create: `site/app.js`

- [ ] **Step 1: Substituir o HTML mínimo pela estrutura completa**

O `site/index.html` deverá conter cabeçalho com a promessa “Ofertas verificadas, no assunto que você escolhe”, três elementos `<article class="niche-card" data-niche="...">`, e em cada artigo dois elementos `<a data-channel="whatsapp">` e `<a data-channel="telegram">`. Incluir no rodapé: “Alguns links compartilhados nos grupos são links de afiliados. Podemos receber comissão sem custo adicional para você.” Carregar `styles.css`, `config.js` e `app.js`.

- [ ] **Step 2: Criar a configuração explícita dos destinos**

Criar `site/config.js`:

```javascript
window.PROMONET_GROUPS = {
  tech: {
    whatsapp: '',
    telegram: ''
  },
  casa: {
    whatsapp: '',
    telegram: ''
  },
  'moda-beleza': {
    whatsapp: '',
    telegram: ''
  }
};
```

- [ ] **Step 3: Implementar a ligação entre botões e configuração**

Criar `site/app.js`:

```javascript
document.querySelectorAll('[data-channel]').forEach((link) => {
  const card = link.closest('[data-niche]');
  const niche = card.dataset.niche;
  const channel = link.dataset.channel;
  const destination = window.PROMONET_GROUPS[niche][channel];

  link.href = destination;
  link.dataset.source = new URLSearchParams(location.search).get('utm_source') || 'direct';
  link.rel = 'noopener noreferrer';
});
```

- [ ] **Step 4: Criar o CSS responsivo**

Em `site/styles.css`, definir largura máxima de 1120 px, grade com três colunas acima de 800 px e uma coluna abaixo desse limite. Garantir contraste legível, foco visível com `:focus-visible`, botões com altura mínima de 44 px e cores distintas para WhatsApp e Telegram.

- [ ] **Step 5: Executar os testes**

Run: `npm test`

Expected: os 2 testes passam.

- [ ] **Step 6: Abrir e revisar em duas larguras**

Run: `start site/index.html`

Expected: três cartões visíveis; em janela estreita, cartões empilhados; cada cartão contém os dois botões.

- [ ] **Step 7: Commit**

```powershell
git add site tests/site-structure.test.js
git commit -m "feat: add niche selection landing page"
```

### Task 5: Validar links e rastreamento de origem

**Files:**
- Create: `tests/tracking.test.js`
- Modify: `site/app.js`

- [ ] **Step 1: Escrever testes para configuração incompleta e origem**

Criar `tests/tracking.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('configuration starts with six safely disabled destinations', () => {
  const config = fs.readFileSync('site/config.js', 'utf8');
  assert.equal((config.match(/:\s*''/g) || []).length, 6);
});

test('client records source and blocks an unpublished destination', () => {
  const app = fs.readFileSync('site/app.js', 'utf8');
  assert.match(app, /utm_source/);
  assert.match(app, /!destination/);
  assert.match(app, /aria-disabled/);
});
```

- [ ] **Step 2: Executar o teste e observar a falha**

Run: `npm test`

Expected: o teste sobre bloqueio falha porque `app.js` ainda não trata destinos provisórios.

- [ ] **Step 3: Adicionar bloqueio explícito**

Substituir a atribuição direta de `href` em `site/app.js` por:

```javascript
if (!destination) {
  link.removeAttribute('href');
  link.setAttribute('aria-disabled', 'true');
  link.title = 'Grupo em preparação';
} else {
  link.href = destination;
  link.rel = 'noopener noreferrer';
}
```

Manter o registro de `data-source` fora do bloco condicional.

- [ ] **Step 4: Executar os testes**

Run: `npm test`

Expected: 4 testes passam.

- [ ] **Step 5: Substituir os seis destinos após criar os grupos**

Editar `site/config.js` usando exclusivamente links de convite copiados das telas administrativas. Não inventar URLs nem usar links encurtados nesta etapa.

- [ ] **Step 6: Verificar que nenhum marcador provisório permanece**

Run: `node -e "const s=require('fs').readFileSync('site/config.js','utf8'); const n=(s.match(/https:\/\/(chat\.whatsapp\.com|t\.me)\//g)||[]).length; if(n!==6) process.exit(1); console.log('6 links configurados')"`

Expected: `6 links configurados`. Antes da criação dos grupos, o comando falha e os campos vazios mantêm os botões bloqueados.

- [ ] **Step 7: Commit**

```powershell
git add site/app.js site/config.js tests/tracking.test.js
git commit -m "feat: validate group destinations and acquisition source"
```

### Task 6: Criar o sistema editorial e o controle de qualidade

**Files:**
- Create: `operations/offer-checklist.md`
- Create: `operations/content-templates.md`
- Create: `operations/editorial-calendar.csv`
- Create: `operations/daily-routine.md`

- [ ] **Step 1: Criar o checklist de ofertas**

O arquivo `operations/offer-checklist.md` terá caixas de seleção para: loja e vendedor confiáveis; preço atual; comparação com referência recente; frete; cupom testado; estoque; restrições; nicho correto; link de afiliado funcional; identificação de publicidade; horário de publicação; revisão após 60 minutos para marcar expiração.

- [ ] **Step 2: Criar quatro modelos completos de conteúdo**

Em `operations/content-templates.md`, incluir modelos preenchíveis para: comparação de dois produtos; “promoção ou preço maquiado”; lista de três achados por faixa de preço; melhor oferta do dia. Cada modelo terá abertura, evidência, recomendação, ressalva e uma única chamada para o grupo do nicho.

- [ ] **Step 3: Criar o calendário inicial de 14 dias**

Criar `operations/editorial-calendar.csv` com o cabeçalho:

```csv
date,niche,format,topic,hook,call_to_action,status,organic_views,group_entries
```

Adicionar 28 linhas, duas por dia, alternando os três nichos. Usar `planned` em `status`; deixar apenas as duas últimas colunas vazias para preenchimento após a publicação.

- [ ] **Step 4: Documentar a rotina de quatro horas**

Criar `operations/daily-routine.md` com os blocos aprovados: 60 minutos de pesquisa, 60 de produção, 45 de publicação, 30 de interação, 30 de análise e 15 de preparação. Incluir uma revisão semanal de 30 minutos na sexta-feira, absorvida pelo bloco de análise desse dia.

- [ ] **Step 5: Verificar quantidade e distribuição do calendário**

Run: `node -e "const f=require('fs').readFileSync('operations/editorial-calendar.csv','utf8').trim().split(/\r?\n/); if(f.length!==29) process.exit(1); console.log('28 conteúdos planejados')"`

Expected: `28 conteúdos planejados`.

- [ ] **Step 6: Commit**

```powershell
git add operations
git commit -m "docs: add editorial workflow and offer quality checks"
```

### Task 7: Preparar parcerias e testes pagos de R$ 500

**Files:**
- Create: `operations/partnerships.md`
- Create: `operations/paid-tests.md`

- [ ] **Step 1: Documentar o processo de parcerias**

Em `operations/partnerships.md`, definir critérios: nicho compatível, público real, comentários coerentes, ausência de spam e possibilidade de link rastreável. Incluir esta abordagem:

```text
Olá, {NOME}. Eu cuido da PromoNET {NICHO}, uma comunidade de ofertas verificadas. Vi que seu público se interessa por {ASSUNTO}. Gostaria de testar uma divulgação pequena e rastreável, com conteúdo útil em vez de anúncio genérico. Posso enviar uma proposta com formato, data e orçamento?
```

Registrar cada contato em tabela com nome, perfil, nicho, audiência, valor, origem usada, entradas, retenção em 7 dias e decisão.

- [ ] **Step 2: Definir os testes pagos**

Em `operations/paid-tests.md`, registrar o orçamento: R$ 250 para mídia, R$ 100 para parcerias, R$ 50 para infraestrutura e R$ 100 de reserva. Criar três testes de R$ 50, um por nicho, usando o melhor conteúdo orgânico de cada um. Cada teste deverá usar uma origem diferente: `meta_tech_t1`, `meta_casa_t1` e `meta_moda_t1`.

- [ ] **Step 3: Definir regras de decisão antes de anunciar**

No mesmo arquivo, estabelecer: não impulsionar conteúdo sem pelo menos 1.000 visualizações orgânicas ou taxa de compartilhamento de 1%; aguardar 7 dias para medir retenção; pausar fonte com retenção inferior a 50%; só usar a reserva na fonte com melhor combinação de custo por membro e retenção; nunca ultrapassar R$ 500 no mês.

- [ ] **Step 4: Commit**

```powershell
git add operations/partnerships.md operations/paid-tests.md
git commit -m "docs: define partnership and paid acquisition experiments"
```

### Task 8: Implantar o painel de métricas e a revisão de 90 dias

**Files:**
- Create: `operations/metrics.csv`
- Modify: `README.md`

- [ ] **Step 1: Criar a base diária de métricas**

Criar `operations/metrics.csv`:

```csv
date,niche,platform,source,new_members,total_members,exits,link_clicks,orders,commission_brl,spend_brl
```

Adicionar seis linhas para o primeiro dia, uma por combinação de nicho e plataforma, preenchendo valores numéricos com `0`.

- [ ] **Step 2: Adicionar fórmulas documentadas ao README**

Adicionar ao `README.md`:

```markdown
## Indicadores semanais

- Custo por membro = gasto da fonte / novos membros da fonte;
- Retenção aproximada = (novos membros - saídas da coorte) / novos membros;
- Taxa de clique = cliques / total de membros expostos;
- Conversão = pedidos / cliques;
- Retorno sobre mídia = comissão atribuída / gasto da fonte.

Toda segunda-feira, comparar nicho, plataforma e origem. Aumentar investimento somente após sete dias de retenção observada.
```

- [ ] **Step 3: Executar a validação completa**

Run: `npm test`

Expected: todos os 4 testes passam.

- [ ] **Step 4: Verificar arquivos operacionais obrigatórios**

Run: `rg --files operations | Sort-Object`

Expected: nove arquivos: `brand-guide.md`, `content-templates.md`, `daily-routine.md`, `editorial-calendar.csv`, `group-setup.md`, `metrics.csv`, `offer-checklist.md`, `paid-tests.md` e `partnerships.md`.

- [ ] **Step 5: Fazer revisão visual final da página**

Conferir em celular e desktop: promessa, três nichos, seis botões, aviso de afiliados, foco por teclado e ausência de rolagem horizontal. Clicar em cada botão somente depois de substituir os links e confirmar que todos levam ao grupo correto.

- [ ] **Step 6: Commit final**

```powershell
git add README.md operations/metrics.csv
git commit -m "docs: add launch metrics and review process"
```

## Marcos de execução

- **Marco 1 — Base pronta:** Tasks 1 e 2 concluídas;
- **Marco 2 — Funil publicável:** Tasks 3 a 5 concluídas e seis links reais configurados;
- **Marco 3 — Operação ativa:** Task 6 concluída e primeiros 14 dias agendados;
- **Marco 4 — Aquisição testada:** Task 7 executada após conteúdo orgânico elegível;
- **Marco 5 — Validação:** Task 8 mantida por 90 dias, com revisão nos dias 30, 60 e 90.

O lançamento público só deve ocorrer no Marco 3. Investimento em anúncios só começa quando ao menos um conteúdo atingir o critério orgânico definido na Task 7.
