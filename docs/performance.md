# Performance e escalabilidade

## Escopo da auditoria

Esta auditoria cobre banco, Data API, serviços TypeScript e renderização React para uma carga inicial
de 600+ produtos e crescimento para milhares de produtos, centenas de milhares de movimentos, notas,
logs e linhas de staging. Consistência, RLS, atomicidade e histórico append-only continuam sendo
invariantes; nenhuma otimização permite escrita direta de saldo ou confirmação parcial de dados
oficiais.

As medições automatizadas usam PGlite em memória e servem como teste de regressão, não como SLA de
produção. Latência de rede, plano do projeto Supabase, cache, concorrência e tamanho real dos JSONB
precisam ser medidos no ambiente hospedado.

## Cargas simuladas

| Cenário                                               | Resultado local observado                  |
| ----------------------------------------------------- | ------------------------------------------ |
| CSV com 10.000 produtos: hash, parsing e normalização | aproximadamente 182 ms                     |
| Pesquisa paginada sobre 1.000 produtos, página 40     | aproximadamente 12–15 ms; somente 25 itens |
| Staging completo, validado e atômico de 1.000 linhas  | aproximadamente 3,6–3,9 s                  |
| Staging completo de 10.000 linhas                     | ultrapassou 30 s no PostgreSQL embutido    |
| Histórico sintético                                   | 20.000 movimentos com 1.000 produtos       |
| Staging sintético para planos                         | 10.000 `import_rows`                       |
| Notas sintéticas                                      | 2.000 notas                                |

O parser e a normalização suportam o teto configurado de 10.000 linhas. O gargalo identificado está
na validação integral do RPC de staging, que faz verificações rastreáveis por linha dentro da mesma
transação. Os novos índices impedem que a detecção de duplicidade degrade para varreduras
quadráticas, mas o custo linear das validações continua relevante. Para a migração inicial de cerca
de 600 produtos o caminho atual permanece proporcional ao cenário de 1.000 linhas. Antes de tornar
10.000 linhas uma carga operacional rotineira, o staging deverá ganhar protocolo idempotente em
chunks e validação set-based; o lote só poderá ficar `READY` após finalizar todos os chunks.

## Auditoria por tabela

### `products` e `stock_balances`

- SKU possui unique funcional, EAN possui índice parcial e categoria possui índice de FK.
- Todas as telas usam paginação no servidor; o limite normal é 25 e o limite rígido é 100.
- `stock_balances.product_id` é PK e atende join e bloqueio do motor em O(log n).
- Não existe consulta React que carregue os 600+ produtos para filtrar localmente.
- `stock_balances` recebe vacuum/analyze antecipado por concentrar updates transacionais.
- Pesquisa substring com `ILIKE '%texto%'` ainda pode fazer scan. Para milhares de produtos isso é
  aceitável; `pg_trgm`/GIN só deve ser adicionado após `pg_stat_statements` confirmar custo relevante,
  pois aumenta escrita e armazenamento.

### `stock_movements`

- A migration adiciona `(created_at desc, id desc)`, necessário para dashboard, relatório geral e
  exportação sem filtro de tipo ou produto.
- Índices compostos existentes cobrem produto, tipo, origem, destino, ator e batch com data/id.
- Índices simples que eram prefixos redundantes foram removidos para reduzir amplificação de escrita.
- Quantidades continuam `NUMERIC`; o índice não altera locking nem a transação do motor.
- Particionamento não foi aplicado prematuramente. Deve ser reavaliado apenas em escala muito maior
  (ordem de dezenas/centenas de milhões), com plano específico para FKs, índices globais, backup e
  histórico permanente.

### `invoices` e `invoice_items`

- `(status, issued_at desc, id desc)` atende listagens por estado/período.
- `(supplier_id, issued_at desc, id desc)` atende fornecedor e também substitui o índice simples da
  FK.
- O unique `(invoice_id, line_number)` atende itens da nota; `(product_id, invoice_id)` atende
  relatórios por produto e substitui o índice simples anterior.
- A confirmação permanece uma transação única com o motor de estoque; nenhum item é confirmado por
  request individual do navegador.

### `audit_logs`

- Paginação ordena por `(created_at desc, id desc)` e filtros possuem índices compostos para ação,
  entidade, ator e request.
- O payload é fechado e não inclui secrets. JSONB antigo/novo não recebe GIN indiscriminado porque as
  telas não fazem pesquisa arbitrária dentro desses documentos.
- Logs permanecem append-only; retenção ou particionamento futuro não pode apagar evidência exigida
  pelo negócio.

### `import_batches` e `import_rows`

- `(import_batch_id, row_number)` é unique e atende paginação, confirmação ordenada e resolução.
- Índices parciais por lote cobrem SKU, EAN, ID externo, nome, documento e razão social normalizados.
  Eles eliminam scans repetidos na detecção de duplicidade para até 10.000 linhas.
- Todas as FKs públicas, inclusive `stock_location_id`, agora possuem índice com a coluna como
  primeiro campo.
- Resumo e preview são calculados no banco. O React mostra no máximo 12 exemplos e 50 linhas com
  erro, em vez de criar milhares de nós DOM.
- `import_rows` recebe vacuum/analyze mais frequente devido às transições de validação, resolução e
  promoção.

### `external_entity_mappings`

- O unique `(source_system, entity_type, external_id)` resolve legado → interno.
- `(entity_type, internal_id)` resolve interno → origens externas.
- O teste de plano cobre os dois sentidos; `legacy_id` continua fora de `products`.

## Queries, joins e N+1

- Pesquisas, relatórios, dashboard e exportações usam RPCs com joins e filtros no PostgreSQL.
- Não foi encontrado N+1 de rede nas listagens React. Seletores independentes são carregados em
  paralelo quando necessários.
- Loops de confirmação de estoque/importação são internos ao PostgreSQL e permanecem na mesma
  transação; convertê-los em requests independentes sacrificaria rollback e não é permitido.
- Exportações percorrem páginas de 500 sequencialmente para detectar mudança de total. Até 100.000
  linhas são permitidas, mas todas as linhas ainda ocupam memória antes de serializar no Web Worker.
  Para volumes recorrentes próximos desse teto, migrar geração para job de backend/Storage.

## Paginação e payload

- CRUD e relatórios: página padrão 25, máximo 100.
- Preview de importação e exportação: máximo 500 por resposta.
- Dashboard: resposta agregada, rankings limitados e até 20 movimentos recentes.
- `OFFSET` foi mantido para preservar total e navegação por página. Com páginas profundas de
  `stock_movements`/`audit_logs`, o custo cresce com a posição. Ao superar aproximadamente 100.000
  linhas e haver navegação profunda real, introduzir contrato keyset `(created_at, id)`; não remover o
  contrato atual sem migração compatível.
- Nenhuma RPC operacional retorna tabelas inteiras sem limite. O teste com 1.000 produtos exige
  payload inferior a 100 KiB para uma página de 25.

## React e bundle

- Módulos operacionais pesados são carregados por `lazy()`. XML/PDF e exportação não entram nas rotas
  até serem utilizados.
- Tabelas recebem somente a página do backend; virtualização não é necessária enquanto o limite de
  100 for respeitado.
- O wizard mantém as 10.000 linhas em memória para normalização, mas limita a renderização. O parser
  ainda roda na thread principal; caso arquivos de 10.000 linhas sejam frequentes, movê-lo para um
  Web Worker é a próxima otimização de UX.
- Exportação já serializa em Web Worker, evitando bloquear a interface na etapa mais pesada.

## RLS e custo de autorização

O Performance Advisor do projeto ligado encontrou duas policies permissivas concorrentes em
`invoices` para `INSERT` e `UPDATE`. Elas foram consolidadas em uma policy por operação, preservando
as condições de ADMIN e STOCK_OPERATOR. Helpers de autorização continuam usando `select` para obter
uma avaliação estável por statement, não por linha.

## Monitoramento de produção

Após aplicar migrations e receber carga real:

1. executar Performance e Security Advisors no Dashboard Supabase;
2. observar queries por tempo total, média e chamadas em `pg_stat_statements`;
3. executar `EXPLAIN (ANALYZE, BUFFERS)` em ambiente de teste com parâmetros representativos;
4. acompanhar cache hit, bloat, locks, vacuum e índices não utilizados;
5. executar `ANALYZE` após migrações/importações extraordinárias de grande volume;
6. remover um índice somente após uso real demonstrar redundância.

Referências: [Query Optimization](https://supabase.com/docs/guides/database/query-optimization),
[Database Advisors](https://supabase.com/docs/guides/database/database-advisors) e
[Database debugging](https://supabase.com/docs/guides/database/inspect).

## Critérios para nova intervenção

- staging acima de 1.000 linhas recorrente ou próximo do timeout: chunks idempotentes + validação
  set-based;
- consultas interativas acima de 300 ms p95: revisar plano e estatísticas antes de criar índice;
- navegação profunda acima de 100.000 movimentos/logs: paginação keyset;
- exportações próximas de 100.000 linhas: job assíncrono no backend e arquivo privado no Storage;
- crescimento extremo de históricos: estudo de particionamento sem violar append-only, auditoria ou
  backup/restore.
