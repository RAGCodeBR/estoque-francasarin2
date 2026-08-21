# Banco de dados

## Estado atual

O Bloco 1 cria a modelagem principal nas três primeiras migrations. Os blocos seguintes adicionam
staging, validação, autorização e o motor transacional:

1. `20260820160000_create_core_types_and_functions.sql`: tipos, schema privado e funções de
   integridade.
2. `20260820160100_create_core_tables.sql`: tabelas, constraints, índices e triggers.
3. `20260820160200_enable_rls_and_lock_api_access.sql`: RLS e bloqueio explícito dos papéis da Data
   API.
4. `20260820173000_extend_import_staging_for_dry_run.sql`: cabeçalhos, mapeamento, resumo do dry-run,
   classificação de linhas e proteção concorrente contra arquivo repetido.
5. `20260820180000_add_import_validation_rules.sql`: estado de validação por linha, ValueMapping,
   sugestões de revisão e candidaturas de categoria aprováveis.
6. `20260820190000_configure_auth_roles_and_rls.sql`: roles fixas, perfil automático, helpers de
   autorização, grants mínimos, policies RLS e bucket privado de importação.
7. `20260820200000_create_stock_transaction_engine.sql`: operações atômicas e idempotentes de
   estoque, bloqueios de concorrência, snapshots de saldo e auditoria.
8. `20260820210000_confirm_product_imports.sql`: modos de importação de produtos, promoção
   transacional do staging, reconciliação explícita e relatório final.
9. `20260820220000_add_master_data_search.sql`: pesquisa paginada de produtos, categorias e locais e
   bloqueio explícito de exclusão física.
10. `20260820230000_add_nfe_xml_receiving.sql`: staging e confirmação transacional de NF-e XML.
11. `20260820240000_add_assisted_pdf_invoice_import.sql`: importação assistida de PDF com revisão
    humana obrigatória.
12. `20260820250000_add_stock_outputs.sql`: saídas individuais e em lote all-or-nothing.
13. `20260820260000_add_losses_and_inventory_counts.sql`: perdas documentadas, contagens e ajustes
    compensatórios.
14. `20260820270000_add_complete_audit_logging.sql`: auditoria completa, append-only e sanitizada.
15. `20260820280000_add_reports.sql`: seis relatórios filtrados e paginados no PostgreSQL, fronteira
    de leitura por roles e índices específicos para período, tipo, local, responsável e referência.
16. `20260820290000_add_operational_data_exports.sql`: exportações operacionais schema version 1,
    filtros/seleções no banco, paginação e ampliação segura da auditoria administrativa.

A promoção definitiva de produtos foi implementada sem telas. O acesso pela Data API segue uma
matriz explícita de roles e permanece default-deny quando não existe policy permissiva.

## Convenções

- Chaves primárias usam UUID. `profiles.id` corresponde a `auth.users.id`; as demais entidades usam
  `gen_random_uuid()`.
- Datas usam `TIMESTAMPTZ` e valores gerados pelo PostgreSQL.
- Quantidades usam `NUMERIC(18,3)`, nunca tipos de ponto flutuante.
- Valores monetários de itens usam `NUMERIC(18,4)` para preço unitário e `NUMERIC(18,2)` para total.
- Textos identificadores obrigatórios possuem checks contra valores vazios.
- JSON de metadados e dados normalizados deve ser objeto; erros de validação devem ser array.
- FKs históricas usam `ON DELETE RESTRICT`. Não há `ON DELETE CASCADE` nas entidades do domínio.
- Cadastros que podem possuir histórico (`products`, `categories`, `locations`, `suppliers`) usam
  `is_active` para inativação lógica.

## Identidade e autorização

### `profiles`

Extensão mínima de `auth.users`, sem duplicar email ou credenciais. Contém nome de exibição, estado
ativo e datas de criação/atualização. A exclusão do usuário é restrita quando existe perfil.

Um trigger em `auth.users` cria o perfil automaticamente usando apenas o prefixo do email como nome
inicial. A migration também faz backfill de perfis para usuários Auth já existentes. Nenhum desses
fluxos concede role. Alterações de ID e data de criação são bloqueadas; somente `ADMIN` pode ativar
ou inativar outro perfil.

### `roles` e `user_roles`

Papéis são dados controlados pela aplicação, identificados por código único sem diferenciação de
maiúsculas e espaços externos. `user_roles` relaciona perfis e papéis e registra quem concedeu e
quando. `user_metadata` não participa do modelo de autorização.

A migration cadastra `ADMIN`, `STOCK_OPERATOR` e `VIEWER`. O primeiro administrador precisa ser
atribuído uma única vez por ambiente administrativo confiável. Depois disso, RLS permite que apenas
administradores ativos gerenciem associações. Triggers impedem remover ou desativar o último
administrador ativo.

## Cadastros principais

### `categories` e `locations`

Nomes são únicos sem diferenciação de maiúsculas e espaços externos. Locais usam `location_type`
(`STOCK` ou `CONSUMPTION`). Ambas registram autoria de criação e atualização.

### `suppliers`

Registra razão social, nome fantasia e documento opcional. Documento informado possui índice único
com normalização de caixa e espaços externos. Variações de pontuação deverão ser normalizadas antes
da gravação pelo fluxo futuro.

### `products`

Produto possui tipo (`RAW` ou `FRACTIONATED`), unidade (`UN` ou `KG`), categoria, quantidade mínima,
autoria e inativação lógica.

A estratégia de SKU usa índice funcional único sobre `lower(btrim(sku))`. Assim, `ITEM-001`,
`item-001` e `item-001` são o mesmo identificador. EAN é opcional e possui índice parcial quando
informado, sem impor formato antes da análise dos dados legados.

### `supplier_product_mappings`

A chave composta `(supplier_id, supplier_product_code)` associa o código usado por cada fornecedor
ao produto interno. Não há `legacy_id` em `products`.

### Pesquisa e ciclo de vida

`search_products`, `search_categories` e `search_locations` recebem página, tamanho e filtros. O
tamanho máximo é 100. A resposta JSON contém `items`, `page`, `page_size` e `total`; o total permanece
correto mesmo quando a página solicitada não possui itens.

Produtos pesquisam por trecho de nome, SKU ou EAN e filtram categoria, tipo, unidade e estado ativo.
Categorias pesquisam nome e estado; locais pesquisam nome, tipo e estado. Todas as funções são
`SECURITY INVOKER` e, portanto, não contornam RLS.

`get_product` consulta um produto por UUID. Tanto essa função quanto a pesquisa serializam
`minimum_quantity` como texto decimal, evitando perda de precisão no JavaScript.

Triggers em `products`, `categories` e `locations` rejeitam `DELETE` e orientam alteração de
`is_active`. Os serviços oferecem apenas inativação e reativação.

## Notas fiscais

`invoices` relaciona fornecedor, identificação fiscal, datas, estado, arquivo original e autor. A
`access_key`, quando informada, é única. Itens possuem número de linha único por nota, produto,
código do fornecedor, descrição, quantidade, unidade e valores.

Itens oficiais exigem produto resolvido. Dados ainda não resolvidos permanecem em `import_rows` e
não são promovidos antecipadamente.

## Estoque central

### `stock_balances`

O Bloco 1 adota um único estoque central, conforme solicitado. A PK é `product_id`, portanto existe
um saldo consolidado por produto. A quantidade possui check de não negatividade. `last_movement_id`
liga o estado materializado ao último evento que o produziu.

Essa tabela concede somente leitura aos três papéis. Nenhum usuário da aplicação possui `INSERT`,
`UPDATE` ou `DELETE`. Somente o motor transacional `SECURITY DEFINER` pode alterá-la.

### `stock_movements`

Cada movimento registra produto, tipo, quantidade positiva, locais opcionais, nota, lote de
importação, motivo, referência compensatória, chave de idempotência, autor, data e snapshots
`balance_before`/`balance_after`. Movimentos novos também registram `unit`, capturada do produto por
trigger no instante do `INSERT`; movimentos históricos anteriores à migration podem manter esse
campo nulo sem que o histórico seja reescrito.

- `idempotency_key` é obrigatória e globalmente única.
- `reference_id` é uma FK para outro movimento e não pode apontar para o próprio registro.
- Origem e destino, quando ambos informados, devem ser diferentes.
- `created_by` é obrigatório.
- Triggers bloqueiam `UPDATE` e `DELETE` para qualquer papel, tornando a tabela append-only.
- Cada produto aceita no máximo um movimento `MIGRATION_OPENING_BALANCE`.

### `stock_consumption_batches` e `stock_consumption_batch_items`

O cabeçalho representa uma confirmação de saída para um destino `CONSUMPTION`. Preserva origem,
destino, chave de idempotência, payload canônico, motivo, autor e instante. Os itens registram linha,
produto, quantidade `NUMERIC(18,3)`, unidade e o `stock_movement` definitivo. As duas tabelas são
append-only, usam FKs restritivas, RLS e concedem apenas leitura aos papéis autorizados.

A chave do cabeçalho é única e vinculada ao usuário e ao payload completo. Isso detecta inclusive
replay parcial ou mudança de ordem/quantidade, além da idempotência individual de cada movimento.

### Motor transacional

As funções públicas são a única API de escrita de estoque:

| Operação                          | Movimento                           | Efeito no saldo central | Roles                 |
| --------------------------------- | ----------------------------------- | ----------------------- | --------------------- |
| `receive_stock`                   | `PURCHASE_ENTRY`                    | soma                    | ADMIN, STOCK_OPERATOR |
| `consume_stock`                   | `CONSUMPTION_EXIT`                  | subtrai                 | ADMIN, STOCK_OPERATOR |
| `consume_stock_batch`             | `CONSUMPTION_EXIT` por item         | subtrai                 | ADMIN, STOCK_OPERATOR |
| `register_loss`                   | `LOSS`                              | subtrai                 | ADMIN, STOCK_OPERATOR |
| `adjust_stock`                    | `ADJUSTMENT_POSITIVE` ou `NEGATIVE` | delta assinado          | ADMIN                 |
| `transfer_stock`                  | `TRANSFER`                          | preserva o total        | ADMIN, STOCK_OPERATOR |
| `apply_migration_opening_balance` | `MIGRATION_OPENING_BALANCE`         | soma                    | ADMIN                 |

Cada chamada valida sessão, perfil ativo, role, produto, quantidade e locais. A transação adquire
locks consultivos pela chave de idempotência e pelo produto e depois bloqueia a linha do saldo com
`FOR UPDATE`. Movimento, saldo, vínculo do último movimento e auditoria confirmam juntos; qualquer
falha desfaz todos eles.

A chave de idempotência é global, limitada a 200 caracteres e vinculada ao usuário e ao payload.
Repetir exatamente a mesma operação pelo mesmo usuário retorna o movimento original com
`applied = false`. Reutilizar a chave com outro usuário ou payload é conflito.

`consume_stock` exige origem `STOCK` e destino `CONSUMPTION`. `consume_stock_batch` recebe de 1 a 100
itens, valida e canonicaliza todo o payload, bloqueia os produtos em ordem estável e chama
`consume_stock` com uma chave determinística por linha. Cabeçalho, itens, movimentos, saldos e
auditoria pertencem à mesma transação; estoque insuficiente em qualquer linha reverte tudo. O replay
exato retorna o relatório original com `applied = false`.

### `stock_losses`

Cada perda documental aponta para exatamente um movimento `LOSS` e repete os campos de consulta
essenciais: produto, quantidade `NUMERIC(18,3)`, unidade fotografada, local `STOCK`, motivo,
observação, chave de idempotência, autor e data. `register_stock_loss` é o único caminho de criação:
ele chama `register_loss` e insere o documento na mesma transação. A tabela é append-only, possui RLS
e não concede mutação direta.

### `inventory_counts` e `inventory_count_items`

`inventory_counts` preserva local, status, referência, observação e autoria/datas de cada marco do
ciclo `DRAFT → COUNTING → REVIEW → CONFIRMED`. A confirmação persiste chave idempotente e relatório.
O cabeçalho nunca é excluído e torna-se imutável depois de confirmado.

Cada item é único por inventário/produto e registra unidade, contagem física, saldo do sistema
fotografado em `REVIEW`, diferença exata e movimento compensatório opcional. Contagem física e saldo
aceitam zero; todas as quantidades usam `NUMERIC(18,3)`, nunca ponto flutuante.

As RPCs `create_inventory_count`, `open_inventory_count`, `save_inventory_count_items` e
`review_inventory_count` exigem `ADMIN` ou `STOCK_OPERATOR`. Nenhuma movimenta estoque.
`confirm_inventory_count` exige `ADMIN`, revalida o snapshot sob os mesmos locks do motor e chama
`adjust_stock` para cada diferença. Uma falha reverte todos os ajustes, itens, status e auditoria.
Se qualquer saldo mudou depois de `REVIEW`, a confirmação é recusada e o inventário pode voltar para
`COUNTING`.

Ajustes avulsos usam `StockAdjustmentService`, que preserva o delta como string decimal assinada e
chama exclusivamente `adjust_stock`. Delta zero é inválido; motivo e idempotência são obrigatórios.

Como o modelo atual possui saldo central por produto, a transferência valida disponibilidade e
registra origem/destino, mas não altera a quantidade agregada. Ela não afirma saldo individual por
local. Uma futura adoção de saldos físicos múltiplos exige nova migration e não deve reinterpretar
silenciosamente este modelo.

O saldo inicial legado exige lote em `READY` ou `IMPORTING`, motivo fixo
`Migração sistema legado` e cria um movimento positivo. Não existe caminho nessa operação para
sobrescrever `stock_balances`.

## Importação e mapeamentos externos

### `import_batches`

Cada lote registra origem, arquivo, tamanho, hash, cabeçalhos detectados, opções de parser,
ColumnMapping e ValueMapping versionados, categorias aprovadas para criação, resumo do dry-run,
status, contagens, autoria, confirmação e metadados. Para produtos, também preserva modo, estratégia
de atualização, decisão sobre quantidade mestre, local, início e relatório da confirmação. Checks
impedem contagens negativas, contagens classificadas acima do total e confirmação parcialmente
preenchida.

Um índice único parcial bloqueia lotes originais ativos com o mesmo hash. Reprocessamento exige
`duplicate_of_batch_id`, preservando a intenção e a rastreabilidade sem impedir correções futuras.

### `import_rows`

É a área de staging obrigatória. Preserva `raw_data`, armazena normalização separadamente, estado de
ciclo e estado de validação, problemas estruturados, sugestões, candidatura de categoria, ação do
dry-run, hash opcional da linha e uma possível entidade resolvida. `(import_batch_id, row_number)` é
único. A FK do lote é restritiva para preservar rastreabilidade.

`validation_state` usa `VALID`, `WARNING`, `ERROR`, `CONFLICT` ou `IGNORED`. Ele é separado de
`validation_status`, que representa o ciclo técnico do staging, e de `dry_run_action`, que descreve
`NEW`, `UPDATE_CANDIDATE`, `CONFLICT` ou `IGNORED`.

Após a confirmação, `promotion_action`, `promoted_at` e `promotion_metadata` registram se a linha
criou, associou, atualizou ou ignorou uma entidade. Linhas acionáveis recebem também o UUID definitivo
em `resolved_entity_id`.

### `external_entity_mappings`

A chave natural `(source_system, entity_type, external_id)` é única e aponta para um UUID interno
genérico. Não existe FK polimórfica, pois o PostgreSQL não consegue garantir uma referência que pode
apontar para diferentes tabelas. A validação da entidade e o registro de auditoria serão
responsabilidade do fluxo específico; a confirmação de produtos já os executa transacionalmente.

### Confirmação definitiva de produtos

`confirm_product_import` aceita dois modos:

- `INITIAL_MIGRATION`: cria ou associa produtos e transforma quantidade positiva em
  `MIGRATION_OPENING_BALANCE` vinculado ao lote.
- `MASTER_DATA_IMPORT`: importa cadastro e exige estratégia explícita quando o arquivo possui coluna
  de quantidade: `IGNORE_EXTERNAL_QUANTITY` ou `RECONCILE_TO_EXTERNAL_QUANTITY`.

`ASSOCIATE_ONLY` preserva campos do produto encontrado; `UPDATE_MASTER_DATA` permite atualizá-los
somente quando external mapping, UUID resolvido, SKU e EAN convergem para um único produto.
Correspondências contraditórias, identificadores duplicados, categoria não aprovada, linha sem
classificação ou estado crítico abortam o lote.

Uma trava consultiva global serializa confirmações de produto, adequada à migração inicial de
centenas e preparada para milhares de linhas com prioridade em consistência. O lote inteiro é uma
unidade transacional: categorias, produtos, mapeamentos, movimentos, linhas, auditoria e status são
confirmados juntos ou revertidos juntos.

O relatório persistido contém produtos criados, associados e atualizados, categorias e movimentos
criados, linhas ignoradas, quantidades externas ignoradas, warnings e erros. Replay com o mesmo lote
e opções retorna esse relatório com `applied = false`; opções diferentes são rejeitadas.

## Auditoria

`audit_logs` comporta ator opcional para eventos do sistema, ação, tipo e ID da entidade, request ID,
estado anterior/novo e metadados. Assim como movimentos, logs de auditoria possuem triggers contra
edição e exclusão.

Triggers transacionais auditam produtos, categorias, locais, fornecedores, notas, staging de NF e
`import_batches`. Ações distinguem criação, alteração, inativação, reativação, confirmação e
cancelamento. O evento de lote inclui obrigatoriamente UUID, nome do arquivo, hash, usuário, instante,
total de linhas e resultado. Movimentos continuam em `stock_movements`; seu evento correlato é
normalizado como ajuste, perda ou abertura de migração e recebe os IDs de nota/lote/local aplicáveis.

`private.audit_payload_is_safe` percorre recursivamente objetos e arrays. Constraints e trigger
`BEFORE INSERT` rejeitam campos de senha, tokens, secrets, `service_role`, JWT, cookies, chaves
privadas e strings de conexão. Os snapshots dos triggers usam listas permitidas por entidade.

`search_audit_logs` filtra ação, entidade, ator, request e intervalo de datas, ordena por
`created_at DESC, id DESC`, limita páginas a 100 e executa como `SECURITY INVOKER`. Índices compostos
cobrem ação/data, entidade/data, ator/data e request/data. `record_administrative_export` registra
somente tipo, formato, total e chave idempotente; não recebe arquivo nem dados exportados.

## NF-e XML e fornecedores

`invoice_imports` e `invoice_import_items` são staging próprio para NF-e. Preservam hash SHA-256,
arquivo, identificação fiscal, fornecedor extraído, dados exatos dos itens, erros, correspondências,
decisões manuais, autoria e relatório final. Possuem RLS forçada e não concedem mutação direta pela
Data API. `STOCK_OPERATOR` enxerga somente seus próprios uploads; `ADMIN` enxerga todos; `VIEWER` e
anônimo não acessam o staging.

O hash do arquivo é único. A chave de acesso de 44 dígitos também é única no staging e em `invoices`.
Quando não existe chave, o fallback fornecedor/número/série impede duplicidade. O staging pode ficar
em `PENDING_REVIEW`; ele só alcança `READY` quando fornecedor, todos os produtos, unidades e erros
estão resolvidos.

`confirm_nfe_import` bloqueia concorrência, revalida o lote, cria `invoices` com status `CONFIRMED`,
cria `invoice_items`, aplica somente os mapeamentos explicitamente aprovados e chama `receive_stock`
com chave determinística por item. Uma falha em qualquer linha reverte nota, itens, mappings,
movimentos, saldos, auditoria e status. O replay com a mesma chave devolve o relatório persistido com
`applied = false`; outra chave é conflito.

Fornecedores são pesquisados por `search_suppliers`, paginada em no máximo 100 linhas. Eles são
inativados, nunca apagados. A identificação da NF-e busca CNPJ normalizado, tolerando pontuação no
cadastro sem enfraquecer a unicidade documental.

### Extensão assistida para PDF

`invoice_import_source` distingue `XML` e `PDF` no mesmo staging. As colunas fiscais e de item podem
ser nulas durante extração assistida; as tabelas oficiais continuam exigindo os campos completos.
`extraction_metadata`, `raw_extraction` e `raw_item_data` preservam parser, páginas, texto e evidência.
`suggested_supplier_id` e `suggested_product_id` não equivalem a resolução: para PDF,
`resolved_supplier_id`/`resolved_product_id` continuam nulos até revisão humana.

`stage_pdf_invoice` é idempotente por hash e sempre produz `PENDING_REVIEW`, mesmo quando todos os
campos parecem legíveis. `review_pdf_invoice` registra `reviewed_at`/`reviewed_by`, permite criar itens
manuais e marcar extrações incorretas como `ignored`. O lote só chega a `READY` quando o cabeçalho e
ao menos um item não ignorado estão completos, com produto ativo e unidade compatível.

`confirm_pdf_invoice` é uma RPC separada da confirmação XML. Ela revalida fonte, revisão, campos,
itens, duplicidade e idempotência; ignora somente linhas explicitamente descartadas e cria nota,
itens, movimentos, saldo e auditoria em uma transação. A função interna renomeada
`confirm_invoice_import_core` permanece sem grant para a Data API.

## Data API e RLS

Todas as 23 tabelas possuem RLS e pelo menos uma policy explícita. `anon` permanece sem privilégios
de tabela. `authenticated` recebe apenas grants compatíveis com a matriz abaixo; toda policy exige
perfil ativo e role apropriada.

| Escopo                                | VIEWER         | STOCK_OPERATOR                         | ADMIN                   |
| ------------------------------------- | -------------- | -------------------------------------- | ----------------------- |
| Cadastros, notas, saldos e movimentos | leitura        | leitura e preparação de notas próprias | leitura e gerenciamento |
| Roles e perfis                        | próprio acesso | próprio acesso                         | gerenciamento           |
| Imports e mapeamentos externos        | negado         | negado                                 | leitura e staging       |
| Auditoria                             | negado         | negado                                 | leitura                 |
| Mutação direta de saldos/movimentos   | negado         | negado                                 | negado                  |

Grants de atualização são também limitados por coluna. IDs, autoria e datas de criação não ficam
editáveis apenas porque uma linha passou pela RLS. `stock_movements` continua protegido adicionalmente
pelos triggers append-only.

Os helpers `private.is_active_user`, `private.has_role` e `private.has_any_role` são
`SECURITY DEFINER`, fixam `search_path` e consultam apenas tabelas de autorização. Somente as funções
necessárias podem ser executadas por `authenticated`; o restante do schema `private` permanece sem
exposição.

Estar no schema `public` não é considerado autorização de acesso.

## Storage de importação

Quando o schema do Supabase Storage está disponível, a migration cria/atualiza o bucket privado
`import-files`, com limite de 10 MiB e MIME types de CSV/XLSX. Policies de objetos permitem
`SELECT`, `INSERT`, `UPDATE` e `DELETE` apenas a `ADMIN`. O bucket nunca é público.

NF-e usa o bucket privado `invoice-xml`, também limitado a 10 MiB e somente XML. `ADMIN` e
`STOCK_OPERATOR` podem inserir exclusivamente sob a pasta cujo primeiro segmento é seu UUID; o
operador lê apenas os próprios objetos. Exclusão é administrativa para não apagar documento de
entrada silenciosamente. O caminho pode ser associado ao staging em `original_file_path`.

PDF fiscal usa `invoice-pdf`, privado, limitado a 15 MiB e MIME `application/pdf`. Operadores gravam
e leem apenas sua pasta; exclusão continua administrativa. O objeto usa caminho determinístico pelo
hash e, em replay, o conteúdo existente é novamente verificado antes de ser reutilizado.

## Índices e integridade

Além das PKs e uniques, existem índices para FKs e consultas previstas por status, hash, EAN,
produto/data do movimento, entidades externas e auditoria. Índices parciais evitam entradas inúteis
para referências opcionais.

Triggers `set_updated_at` mantêm timestamps mutáveis no banco. Constraints, motor transacional e
confirmação de importação expressam as invariantes conhecidas.

## Relatórios

As RPCs `report_current_stock`, `report_consumption`, `report_losses`, `report_entries`,
`report_stock_movements` e `report_migration_opening_balances` retornam JSON com `items`, `page`,
`page_size` e `total`. Página começa em 1 e o tamanho máximo é 100.

- Estoque atual classifica cada produto como `OUT_OF_STOCK`, `BELOW_MINIMUM` ou `OK`.
- Consumo soma `CONSUMPTION_EXIT` por produto, categoria e destino no período solicitado.
- Perdas usam o registro documental de `stock_losses`, incluindo motivo, local e responsável.
- Entradas mostram somente itens de notas `CONFIRMED`, com preço e total em precisão original.
- Movimentações preservam tipo, unidade fotografada, locais, autoria e referências.
- Migração lê somente `MIGRATION_OPENING_BALANCE` vinculado a lote e expõe origem sanitizada.

Quantidades e valores são serializados como texto; nenhum relatório converte `NUMERIC` em ponto
flutuante. Índices compostos cobrem os principais filtros temporais por tipo, local, usuário,
fornecedor, produto e lote.

## Dashboard

`get_inventory_dashboard` agrega no banco os produtos ativos, as situações de mínimo/sem estoque e
as movimentações dos últimos 7, 30 ou 90 dias. A resposta inclui entradas, consumo, perdas, total de
movimentos, série de consumo, produtos mais consumidos, perdas por categoria, consumo por local e
até 20 movimentos recentes. O período de 90 dias usa buckets semanais; os demais usam buckets
diários.

Todas as quantidades permanecem como texto decimal exato e são agrupadas por `unit_type`; KG nunca é
somado com UN. A função tem `search_path` fixo, verifica perfil ativo e role de relatório, não concede
acesso a `anon` e projeta somente campos operacionais. O índice existente
`stock_movements_type_created_at_report_idx` atende o recorte por tipo/data, enquanto PKs e índices de
FK atendem as associações, evitando índices redundantes para esta leitura.

## Exportações operacionais

`export_operational_data_page` aceita tipo, filtros JSON allowlisted, UUIDs selecionados, página e
tamanho. A página máxima é 500 e a seleção explícita máxima é 10.000 UUIDs. A RPC exige `ADMIN`, usa
SQL estático e retorna somente colunas predefinidas, `schema_version`, tipo, total e linhas.

Os tipos disponíveis são `PRODUCTS`, `CATEGORIES`, `LOCATIONS`, `SUPPLIERS`, `STOCK_CURRENT`,
`STOCK_MOVEMENTS`, `LOSSES`, `INVOICES` e `PRODUCTS_WITH_CURRENT_STOCK`. Notas são exportadas por
item, repetindo a identificação humana da nota, fornecedor e produto. UUIDs permanecem para
rastreabilidade, mas nunca são a única identificação das entidades relacionadas.

Quantidades e valores monetários saem como texto decimal exato. Caminhos internos de arquivos,
metadados de autenticação, staging bruto e credenciais não integram nenhuma projeção. A função
`record_administrative_export` aceita os nove tipos e registra `export_schema_version = 1` somente
depois da geração bem-sucedida do arquivo.

## Testes locais

`tests/integration/database-schema.test.ts` inicia PostgreSQL embutido via PGlite, simula apenas os
objetos Supabase externos necessários (`auth.users`, `anon`, `authenticated`), executa todas as
migrations em ordem e testa o catálogo e as invariantes.

Os testes alternam entre `anon` e `authenticated`, simulam o `auth.uid()` de admin, operador,
visualizador, usuário sem role e perfil inativo, e executam consultas/mutações reais sob RLS. Storage
é validado ao aplicar a migration em Supabase, pois suas tabelas pertencem à plataforma e não ao
PostgreSQL embutido.

`tests/integration/stock-engine.test.ts` executa as sete RPCs no PostgreSQL, cobrindo entrada,
consumo, perda, ajustes, abertura legada, transferência, concorrência, replay idempotente, conflito
de chave, rollback forçado, estoque negativo e usuários sem autorização.

O mesmo teste cobre `consume_stock_batch` com saída individual, snapshots de unidade, lote
all-or-nothing, replay, conflito de payload, destino inválido, estoque insuficiente e lotes
concorrentes. O serviço TypeScript possui testes unitários de normalização decimal e limites.

`tests/integration/losses-and-inventory-counts.test.ts` cobre perda completa, replay, saldo
insuficiente, autorização, os quatro estados do inventário, exemplos positivo e negativo, ausência de
efeito antes da confirmação, snapshot obsoleto, rollback integral e imutabilidade. Serviços de perda
e inventário possuem testes unitários próprios.

`tests/integration/audit-logs.test.ts` cobre CRUD auditado, distinção entre evento e movimento,
ajuste, perda, migração, NF, lote com metadados completos, exportação idempotente, paginação, índices,
RLS, imutabilidade e rejeição recursiva de secrets. O serviço de consulta/exportação possui testes
unitários de normalização e limites.

`tests/integration/product-import-confirmation.test.ts` promove uma fixture principal de 220 linhas e
cobre replay, associação, atualização opt-in, quantidade mestre ignorada, reconciliação por
movimento, rollback intermediário, conflitos, classificação obrigatória e autorização.

`tests/integration/master-data-search.test.ts` cria 650 produtos e valida páginas cheias e vazias,
total, pesquisa por SKU, filtros, categorias, locais, limite de 100, RLS, autoria, ausência de saldo
no payload e preservação do saldo durante edição cadastral.

`tests/integration/nfe-receiving.test.ts` cobre staging sem efeito oficial, associação por código e
EAN, proibição de merge por descrição, revisão manual, criação opt-in de mapping, confirmação,
duplicidade, idempotência, rollback integral e RLS. O parser possui testes próprios para extração,
precisão, limites e XML hostil.

`tests/integration/pdf-invoice-import.test.ts` cobre campos ausentes, leitura parcial, fornecedor e
produto desconhecidos, ausência de associação por descrição, revisão obrigatória, separação entre
RPCs XML/PDF, confirmação por `receive_stock`, replay e duplicidade. Testes unitários cobrem assinatura
inválida, PDF quebrado, ausência de texto e extração conservadora com evidência de página.

`tests/integration/reports.test.ts` cobre os seis relatórios, filtros de período e entidades,
agregação, precisão decimal, origem sanitizada da migração, as três roles autorizadas, anônimo,
usuário sem role, limites de paginação e índices. O serviço TypeScript possui testes unitários de
normalização de datas, UUIDs, pesquisa e paginação.

`tests/integration/dashboard.test.ts` executa a agregação real, valida indicadores, buckets,
rankings independentes de KG/UN, limite do histórico, as três roles autorizadas e rejeições de
anônimo, usuário sem role e parâmetros inválidos. Os testes unitários cobrem os defaults do serviço
e a apresentação de unidades sem mistura.

`tests/integration/performance-scale.test.ts` cria 1.000 produtos, 20.000 movimentos, 10.000 linhas
de staging e 2.000 notas. Ele valida paginação/payload, planos dos índices temporais e de staging,
lookup externo nos dois sentidos, cobertura de todas as FKs públicas e ausência de policies
permissivas duplicadas. Também executa o RPC completo de staging com 1.000 produtos. O parser é
testado separadamente com um CSV real de 10.000 linhas; medições e gargalos estão documentados em
`docs/performance.md`.

`tests/integration/operational-exports.test.ts` cruza os nove schemas TypeScript com as projeções SQL,
testa filtros, seleção específica, paginação, autorização e auditoria. Testes unitários cobrem todas
as páginas, limites, CSV UTF-8, neutralização de fórmulas, estrutura OpenXML, leitura do XLSX pelo
importador e JSON técnico versionado.

## Importações operacionais

A migration `20260820300000_add_operational_imports.sql` adiciona o enum
`operational_import_type`, os campos de tipo/motivo/idempotência em `import_batches` e o snapshot
`operational_preview` em `import_rows`. Índices atendem consulta de lotes por tipo/status, replay por
chave e identificação do produto no preview.

As RPCs expostas somente a `authenticated` aplicam autorização `ADMIN` internamente:

- `stage_operational_import_preview` classifica e persiste apenas staging;
- `get_operational_import_preview` pagina até 500 linhas;
- `resolve_operational_import` registra decisões e aprova categorias candidatas;
- `confirm_operational_product_import` promove produtos sem quantidade;
- `confirm_operational_master_data_import` promove categorias, locais ou fornecedores;
- `confirm_stock_reconciliation_import` revalida o snapshot e usa
  `private.execute_stock_movement` para cada diferença.

Nenhuma grant direta de escrita foi adicionada às tabelas oficiais. O lote, suas linhas, movimentos
e auditoria compartilham a mesma transação de confirmação.
