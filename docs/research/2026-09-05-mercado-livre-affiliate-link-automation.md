# Pesquisa: automação de links de afiliado do Mercado Livre Brasil

Data da pesquisa: 5 de setembro de 2026.

## Resumo executivo

Não foi encontrada, na documentação pública atual do Mercado Livre, uma API oficial para criar links do Programa de Afiliados e Criadores. A API pública autenticada por OAuth documenta integrações do marketplace, enquanto as instruções oficiais do programa apresentam três meios de criação: **Gerador de Links**, **Central de Afiliados e Criadores** e **Barra de Afiliados**. Portanto, um token OAuth de uma aplicação comum não deve ser tratado como autorização para usar o endpoint web interno do portal.

Para o PromoNET, a melhor alternativa técnica disponível é uma automação **controlada da interface oficial**, usando Playwright com um perfil Chromium exclusivo e persistente, inicialmente com o navegador visível. Ela deve processar uma fila serial, validar o domínio e o produto antes de preencher o gerador, capturar o resultado exibido na própria interface, aplicar limites baixos e parar para intervenção humana diante de login, CAPTCHA, desafio de segurança ou mudança de tela.

Esta opção não é equivalente a uma API oficial e pode quebrar quando o portal mudar. Antes de operação contínua, recomenda-se pedir ao suporte do programa uma confirmação expressa de que automação assistida do Gerador de Links é permitida. Na ausência dessa confirmação, o modo mais conservador é semiautomático: o robô abre e preenche, mas o operador confirma a geração.

## Comparação das alternativas

| Alternativa | Estabilidade | Segurança da sessão | Situação contratual | Automação | Recomendação |
|---|---:|---:|---|---:|---|
| API pública oficial de afiliados | Potencialmente alta | OAuth | Não localizada/documentada | Alta | Não está disponível para implementação com a documentação atual |
| Ferramentas oficiais, uso manual | Alta | Sessão normal do ML | Claramente previsto pelo programa | Baixa | Referência segura e fallback operacional |
| Playwright sobre o Gerador/Barra oficial | Média/baixa | Boa com perfil dedicado | Automação não confirmada publicamente | Média/alta | Melhor protótipo, com limites e intervenção humana |
| Chamada direta ao endpoint web interno | Baixa | Exige cookies/CSRF privados | Não documentada nem contratualmente garantida | Alta enquanto funcionar | Não recomendada para produção |
| Extensão de terceiros ou serviço de scraping | Baixa/variável | Frequentemente exige acesso à conta/cookies | Depende do fornecedor | Variável | Evitar, salvo parceiro formalmente validado |

## 1. API pública e OAuth

O DevCenter explica que a criação de uma aplicação fornece `Client_Id` e `Secret_Key` para acessar o ecossistema de **APIs públicas**, com escopos de leitura e escrita. Contudo, a documentação pública consultada não contém um recurso de afiliados nem uma operação de criação de link. Fonte: [Crie uma aplicação no Mercado Livre](https://developers.mercadolivre.com.br/crie-uma-aplicacao-no-mercado-livre).

Conclusão prática: OAuth continua útil para endpoints públicos documentados, mas não prova que um endpoint interno do portal de afiliados aceite ou deva aceitar esse token. O HTTP 403 já observado no projeto é compatível com essa separação. Só seria apropriado migrar para API se o Mercado Livre publicar a operação ou conceder acesso formal por suporte/parceria.

## 2. Ferramentas oficiais disponíveis

O próprio Mercado Livre descreve estas formas:

- **Gerador de Links no Portal do Afiliado:** colar a URL do produto, gerar e copiar; funciona no computador.
- **Barra de Afiliados:** ativada nas configurações do portal; na página de produto, a ação Compartilhar gera link ou ID de produto e funciona também no celular.
- **Central de Afiliados e Criadores:** permite escolher um produto e compartilhar o link ou ID.

Fontes: [Como gerar seus links](https://www.mercadolivre.com.br/l/afiliados-gere-seus-links) e [Comece a recomendar](https://www.mercadolivre.com.br/l/comece-a-recomendar).

O programa também oferece **etiquetas** para medir origem/campanha. Podem existir até 100; a criação é feita no computador, o nome tem até 30 caracteres e, segundo a orientação atual, usa letras e números sem espaços, maiúsculas ou caracteres especiais. Uma etiqueta não pode ser eliminada e deve ser vinculada durante a criação do link. Fontes: [Crie etiquetas](https://www.mercadolivre.com.br/l/afiliados-crie-etiquetas) e [Organize seus links](https://www.mercadolivre.com.br/l/organize-seus-links).

## 3. Endpoint web interno e “scraping de API”

O portal atualmente faz uma chamada interna semelhante a `POST /affiliate-program/api/v2/affiliates/createLink`, autenticada pela sessão web e por proteção CSRF. Essa observação é evidência de implementação do site, **não documentação pública**.

Vantagem: chamar a mesma requisição é mais rápido e menos sensível a alterações visuais que clicar no DOM. Desvantagens decisivas:

- contrato, formato, cabeçalhos e URL podem mudar sem versionamento público ou aviso;
- cookies, CSRF e outros controles de risco expiram ou são rotacionados;
- copiar cookies para arquivo ou chat cria credenciais capazes de representar a conta;
- OAuth público não substitui necessariamente a sessão web;
- repetição automatizada pode acionar proteção antifraude, reautenticação ou bloqueio;
- o uso direto não é apresentado como ferramenta de criação de links nas instruções do programa.

Recomendação: não construir a operação de produção em torno dessa requisição. No máximo, a automação de navegador pode **observar a resposta feita pela própria página** para extrair o link com precisão, sem fabricar chamadas, reutilizar cookies fora do contexto nem contornar controles.

## 4. Automação de navegador recomendada

### Arquitetura

1. Executar Chromium via Playwright em processo/contêiner separado do bot.
2. Usar diretório de perfil **exclusivo**, persistente e montado em volume local protegido.
3. Fazer o primeiro login manualmente com janela visível; nunca armazenar senha no projeto.
4. Consumir uma fila serial de URLs de produtos, uma por vez.
5. Abrir o Gerador de Links oficial ou a página do produto com a Barra ativada.
6. Preencher/clicar usando locators semânticos (papel, rótulo e texto), não seletores CSS frágeis.
7. Aceitar como sucesso apenas um link retornado pela interface e com host esperado (`meli.la` ou outro host oficialmente apresentado naquele momento).
8. Manter cache `URL canônica + etiqueta -> link gerado` para evitar regeneração.
9. Diante de login, CAPTCHA, verificação, erro desconhecido ou mudança de UI: pausar a fila, não tentar contornar e solicitar intervenção.
10. Só liberar o link ao bot WhatsApp depois da validação; manter `DRY_RUN=true` até teste ponta a ponta supervisionado.

O Playwright documenta `launchPersistentContext(userDataDir)` para persistir cookies e armazenamento local. Também alerta que o perfil padrão do Chrome não deve ser automatizado e recomenda um diretório separado. Fonte: [Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).

O estado autenticado é sensível e pode permitir personificação da conta; não deve entrar nem mesmo em repositório privado. Fonte: [Playwright — Authentication](https://playwright.dev/docs/auth).

### Por que não usar o navegador pessoal via CDP

O Playwright informa que `connectOverCDP` tem fidelidade inferior à conexão nativa do Playwright. Além disso, automação do perfil diário mistura cookies pessoais, aumenta o raio de impacto de uma falha e conflita com mudanças recentes do Chrome que restringem depuração do perfil padrão. Um Chrome/Chromium dedicado é mais previsível e isolado.

### Limites conservadores sugeridos

Estes valores não são limites publicados pelo Mercado Livre; são controles internos prudentes para o protótipo:

- concorrência 1;
- intervalo aleatório moderado entre itens, sem tentar imitar comportamento humano para burlar detecção;
- teto inicial de 20–50 links/dia enquanto se observa estabilidade;
- no máximo uma nova tentativa automática por falha transitória;
- circuit breaker após 3 falhas consecutivas;
- janela manual para autenticação, desafio ou CAPTCHA;
- auditoria sem cookies, tokens, URLs de callback ou conteúdo sensível.

Não se deve implementar evasão de CAPTCHA, rotação de proxies, falsificação de fingerprint ou recuperação clandestina de cookies.

## 5. Regras do programa relevantes ao projeto

- O Mercado Livre afirma que os links devem ser gerados pelas ferramentas de criação disponibilizadas pelo programa. Também proíbe redirecionar automaticamente uma visita para o Mercado Livre ou abrir automaticamente o site em outra aba/janela. Fonte: [Direcionamento de visitas](https://www.mercadolivre.com.br/l/afiliados-direcionamento-de-visitas).
- WhatsApp e Telegram são aceitos apenas em grupos, comunidades ou canais **públicos**; grupos privados são listados como não permitidos. Fontes: [Onde compartilhar links](https://www.mercadolivre.com.br/l/afiliados-onde-compartilhar-links), [Checklist do afiliado](https://www.mercadolivre.com.br/l/checklist) e [Perguntas frequentes](https://www.mercadolivre.com.br/l/primeiros-passos-perguntas-frequentes-para-afiliados).
- Há páginas que não geram links elegíveis, incluindo página inicial, busca, categorias, vendedores, carrinho e pagamentos. Deve-se aceitar apenas página de produto específico. Fonte: [Páginas não permitidas](https://www.mercadolivre.com.br/l/afiliados-paginas-nao-permitidas).
- A conta pode sofrer suspensão e perda de ganhos por descumprimento; compras próprias por links do afiliado também não são permitidas. Fontes: [Perguntas frequentes](https://www.mercadolivre.com.br/l/primeiros-passos-perguntas-frequentes-para-afiliados) e [Política de compras próprias](https://www.mercadolivre.com.br/l/afiliados-politica).

Impacto imediato: se o grupo de destino do PromoNET for privado, a divulgação conflita com a orientação oficial atual, independentemente da técnica de geração do link. O canal precisa ser tornado público/declarado e essa condição deve ser confirmada antes de sair do modo de simulação.

## 6. Decisão recomendada

Ordem de preferência:

1. Solicitar ao suporte do Programa de Afiliados acesso a API ou autorização escrita para automação assistida.
2. Enquanto isso, prototipar Playwright com perfil dedicado, navegador visível, fila serial e confirmação humana final.
3. Após confirmação e testes, permitir geração automática, mas continuar pausando em qualquer desafio ou alteração da interface.
4. Manter o fluxo manual oficial como fallback.
5. Não usar cookies colados, endpoint interno isolado, proxy rotativo, CAPTCHA solver ou extensões desconhecidas.

Critérios antes de ativar publicação real:

- canal/grupo público e declarado no perfil do programa;
- resposta formal do suporte ou avaliação explícita do risco contratual;
- sessão em volume dedicado com ACL e exclusão do Git;
- validação estrita das URLs de entrada e saída;
- cache, idempotência, rate limit e circuit breaker;
- teste supervisionado ponta a ponta;
- botão de pausa e fallback manual;
- política de logs que nunca exponha credenciais.

## Limitações desta pesquisa

A ausência de uma API pública foi determinada pela documentação e buscas oficiais disponíveis na data acima; ela não prova que não exista uma API privada ou acesso concedido a parceiros selecionados. Endpoints internos observados podem mudar a qualquer momento. As páginas oficiais consultadas explicam onde gerar e divulgar links, mas não declaram de forma específica se automação de navegador do gerador é permitida; por isso é necessária confirmação do suporte antes de operação autônoma em escala.
