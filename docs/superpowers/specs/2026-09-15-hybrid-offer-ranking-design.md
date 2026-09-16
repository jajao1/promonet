# Ranking híbrido de ofertas

## Objetivo

Selecionar ofertas com evidência de demanda real sem confundir vendas acumuladas com tendência e sem excluir nichos de menor volume. O ranking oficial do Mercado Livre continua sendo a fonte de descoberta; o PromoMega passa a reordenar os candidatos com métricas comparáveis dentro de cada categoria.

## Abordagens consideradas

1. **Corte absoluto de vendas.** Simples, mas favorece produtos antigos e baratos e esvazia categorias menores.
2. **Somente ranking oficial.** Estável e barato, porém aceita itens com baixa demanda absoluta e não mede crescimento.
3. **Pontuação híbrida e relativa (escolhida).** Combina ranking, vendas e desconto agora, registra snapshots e permite acrescentar velocidade de vendas quando houver histórico suficiente.

## Fonte e enriquecimento

O endpoint de destaques por categoria fornece a lista inicial e sua posição. A consulta em lote dos itens solicitará também `sold_quantity` e os campos de reputação disponíveis na resposta oficial. Campos ausentes não tornam o item inválido; recebem contribuição neutra para que mudanças ou limitações da API não interrompam o coletor.

Produtos de catálogo devem usar as métricas do anúncio escolhido para preço e popularidade, preservando o identificador canônico já usado na deduplicação.

## Pontuação imediata

Os candidatos elegíveis serão avaliados dentro do conjunto retornado para a mesma categoria:

- 40%: posição normalizada no ranking oficial;
- 35%: vendas normalizadas por percentil/logaritmo dentro da categoria;
- 25%: desconto real normalizado.

A ordenação terá desempates determinísticos por posição original, maior desconto e ID. Não haverá mínimo universal de vendas. Um produto com poucas vendas só ultrapassará produtos mais vendidos se possuir combinação significativamente melhor de posição e desconto.

## Composição da rodada

A diversidade já existente entre nichos permanece. Dentro de cada nicho, a maior parte das vagas usa a pontuação híbrida. Como o coletor normalmente publica uma oferta por nicho em cada rodada, a exploração de produtos emergentes acontece pela rotação de categorias e pela ausência de corte absoluto, sem criar uma segunda fila capaz de reduzir a diversidade.

## Histórico para tendência

Será criada uma tabela de snapshots com item, categoria, quantidade vendida, posição, preço e horário da observação. Cada coleta gravará uma amostra idempotente por janela de 20 minutos. Nesta entrega, os snapshots são registrados e a pontuação imediata entra em produção. A velocidade de vendas só será ativada numa entrega posterior, depois de existir pelo menos 24 horas de dados reais para calibrar limites e evitar falsos sinais.

## Falhas e compatibilidade

- Falha ao obter métricas adicionais não impede a coleta dos campos básicos.
- Valores negativos, não numéricos ou inconsistentes são tratados como ausentes.
- O filtro de comida, a exigência de desconto, a deduplicação de sete dias e as cotas por nicho continuam obrigatórios.
- Logs e métricas não devem expor tokens, cookies ou respostas sensíveis.

## Testes e aceitação

- A fonte normaliza `sold_quantity` quando presente e tolera sua ausência.
- A pontuação favorece um candidato com demanda comprovada sem ignorar posição e desconto.
- A comparação é relativa à categoria e determinística.
- Produtos sem métricas continuam elegíveis, mas não recebem vantagem artificial.
- O schema e a gravação de snapshots são idempotentes.
- A suíte completa permanece verde e um teste de integração confirma a migração no PostgreSQL quando o ambiente estiver disponível.

## Fora de escopo

- Prever vendas futuras por aprendizado de máquina.
- Usar scraping para complementar métricas ausentes.
- Ativar velocidade de vendas antes de haver histórico suficiente.
- Alterar frequência, horário ou quantidade de publicações.
