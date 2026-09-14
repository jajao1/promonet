# Bot PromoNET Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entregar o bot e sua infraestrutura Docker, sem site e sem ativar publicações reais.

**Architecture:** Adaptadores Evolution/Mercado Livre separados do processamento e da fila PostgreSQL. Redis atende Evolution; o bot conserva seus trabalhos no PostgreSQL. Configuração de rotas e credenciais montada somente para leitura.

**Tech Stack:** Node.js 24, pg, node:test, Docker Compose, Evolution v2.3.7, PostgreSQL 16 e Redis 7.

## Sequência de execução

- [x] Criar testes comportamentais em bot/test antes da implementação; executar `npm test` e observar a falha inicial.
- [x] Implementar bot/core.mjs, bot/clients.mjs, bot/runtime.mjs e bot/server.mjs: normalização de eventos, filtros, clientes HTTP com tempo limite, processamento e fila persistente. Testar com respostas simuladas, sem dados de sessão reais.
- [x] Criar compose.yaml, Dockerfile, .dockerignore, .env.example e configuração vazia segura. Executar `docker compose --env-file .env.example config --quiet`.
- [x] Criar README com pareamento, webhook com segredo em cabeçalho, rotas, sessão externa, ativação e observabilidade.
- [x] Executar `npm test` e construir imagem com `docker compose --env-file .env.example build bot`.
- [x] Subir ambiente isolado de verificação com credenciais de exemplo e DRY_RUN=true, testar health/webhook e reinício sem usar WhatsApp real.
- [x] Realizar revisão de conformidade e depois qualidade; corrigir achados e repetir verificações.
- [x] Entregar comandos de inicialização e limitações explícitas: falta número, sessão atual e teste ponta a ponta real.

Os arquivos anteriores do site são preservados, não executados. A pasta não era um repositório Git; não há branch ou worktree existente a alterar.

## Resultado verificado em 04/09/2026

24 testes unitários/comportamentais e 1 teste integrado Docker aprovados. Compose validado e imagem construída. PostgreSQL real confirmou deduplicação, limpeza do payload simulado e persistência após reinício; webhook sem segredo retornou 401. Revisões de requisitos e qualidade concluídas sem achados bloqueantes remanescentes. Containers do projeto isolado promonet-check removidos após teste; imagens e volumes de teste preservados. Nenhum envio ao WhatsApp nem chamada autenticada ao Mercado Livre foi feito nesta implementação.
