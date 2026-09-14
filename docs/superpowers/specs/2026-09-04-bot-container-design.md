# Bot PromoNET em containers — arquitetura aprovada

Substitui o site como prioridade de implementação. A estratégia comercial anterior permanece como referência; o plano técnico do site está suspenso.

## Escopo

Docker Compose com Evolution API, bot Node.js, PostgreSQL e Redis. O bot recebe eventos de grupos WhatsApp de terceiros autorizados pelo usuário, converte links Mercado Livre com a sessão da conta de afiliado e publica automaticamente nos destinos configurados. Amazon e Shopee ficam fora do MVP.

## Fluxo e limites

Webhook autenticado → lista de grupos permitidos → filtro de mensagens próprias e duplicadas → fila persistente → conversão de todos os links → publicação de texto ou imagem com legenda.

As rotas são explícitas por origem/destino; não há classificação por IA. Uma tag é configurada por destino, reutilizada e criada apenas quando a rota sinalizar necessidade. Falhas de sessão, conversão, mídia ou envio deixam o trabalho retido, nunca publicam o link do afiliado original. Envios de resultado incerto não são repetidos automaticamente.

Modo inicial DRY_RUN=true: não chama Mercado Livre nem envia ao WhatsApp. Simulação não valida comissão, preço, cupom ou disponibilidade. Texto e mídia autorizados são preservados, sem remoção de marcas-d'água. Credenciais não são incluídas no código, logs ou imagem Docker.

## Dependências operacionais

Número WhatsApp ainda não disponível; pareamento e testes reais dependem do usuário. A conexão da Evolution via WhatsApp Web não é a API oficial da Meta e mantém os riscos já informados. O endpoint interno createLink teve uma chamada bem-sucedida nesta conversa; isso não garante contrato estável nem sessão permanente. createTag ainda requer validação real.

## Aceite

Testes automatizados de filtros, segurança do webhook, conversão, deduplicação e modo simulado. Compose validado, imagem do bot construída e smoke test local com persistência. Sem publicações reais ou reutilização dos cookies enviados na conversa durante os testes.
