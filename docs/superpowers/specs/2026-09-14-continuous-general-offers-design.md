# Coleta contínua de ofertas gerais

## Objetivo

Preencher continuamente o site PromoMega e o grupo público de WhatsApp com ofertas novas do Mercado Livre, sem limite diário fixo. A automação deve preservar qualidade, evitar duplicatas e interromper com segurança quando uma integração perder autenticação.

## Escopo de categorias

O coletor abrangerá tecnologia, games, casa, moda, beleza, saúde, esportes, ferramentas, automotivo, bebê e supermercado. Todas as categorias publicarão no mesmo grupo atualmente configurado. A configuração continuará permitindo ativar, desativar ou redirecionar cada nicho sem alteração de código.

## Frequência e volume

Um agendador executará a cada cinco minutos. Não haverá teto diário de publicações. Cada execução buscará candidatos em todas as categorias vencidas e poderá processar vários produtos, respeitando a quantidade configurada por nicho.

O sistema não enviará o mesmo item novamente durante sete dias. A ausência de limite diário não elimina controles de fluxo: os envios serão serializados e espaçados para evitar rajadas contra o WhatsApp ou o Mercado Livre.

## Fluxo de dados

1. O coletor obtém destaques e detalhes de produtos pela API oficial do Mercado Livre usando OAuth.
2. A política de seleção aceita somente produtos ativos, URLs oficiais, imagens HTTPS válidas, preços positivos e descontos verificáveis.
3. Itens publicados nos últimos sete dias são removidos dos candidatos.
4. Para cada candidato aceito, a sessão autenticada de afiliados gera e valida um link `meli.la` com a etiqueta configurada.
5. O Evolution envia imagem, descrição, preço, desconto, indicação de publicidade e link ao grupo configurado.
6. Somente uma confirmação inequívoca do Evolution marca o item como publicado.
7. As ofertas publicadas ficam imediatamente disponíveis no site PromoMega.

## Componentes

- `config/niches.json`: categorias, destino, etiqueta, quantidade por ciclo e estado de ativação.
- `OfficialOfferSource`: consulta e normaliza candidatos da API oficial.
- Política de ofertas: filtra, ordena e deduplica candidatos.
- Coletor: processa lotes, gera links e coordena publicações.
- `CollectorStore`: registra execuções, prévias, revisões e publicações.
- `EvolutionClient`: envia mensagens serialmente e exige confirmação.
- `SessionAlert`: notifica o administrador quando a sessão de afiliados deixa de funcionar e quando é restabelecida.

## Falhas e recuperação

- OAuth inválido: a coleta pausa sem publicar dados incompletos.
- Sessão de afiliados expirada: nenhum link comum é enviado; o administrador recebe uma notificação solicitando nova requisição `createLink`.
- WhatsApp desconectado: a oferta permanece em revisão e não é marcada como publicada.
- Resposta ambígua de envio: não há repetição automática, evitando mensagens duplicadas.
- Candidato inválido ou sem desconto: é ignorado.
- Uma categoria com falha não impede a tentativa das demais no próximo ciclo.

## Controles operacionais

O intervalo padrão será de cinco minutos e o intervalo entre mensagens de um lote será configurável. A quantidade por ciclo será configurável por nicho e não representará limite diário. Logs não poderão conter cookies, tokens, chaves, links privados de grupos ou corpos integrais de respostas autenticadas.

## Testes e critérios de aceite

- Todas as categorias configuradas são percorridas sem que uma categoria monopolize o agendador.
- Mais de uma oferta pode ser publicada em um ciclo quando houver candidatos válidos.
- Um item publicado não reaparece durante sete dias.
- Links comuns nunca são enviados quando a conversão afiliada falha.
- Publicações recebem confirmação do Evolution antes de serem persistidas.
- Falhas de uma oferta não descartam silenciosamente as demais.
- O site lista todas as ofertas publicadas, não apenas a mais recente.
- A suíte atual permanece aprovada e recebe cobertura para lotes, múltiplos nichos, deduplicação e falhas parciais.

## Fora do escopo

Não haverá garantia de quantidade mínima quando o Mercado Livre não retornar ofertas válidas. Também não haverá publicação de páginas de busca, vendedores, carrinho ou URLs externas, nem tentativa de contornar captcha ou bloqueios de autenticação.
