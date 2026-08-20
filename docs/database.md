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
`balance_before`/`balance_after`.

- `idempotency_key` é obrigatória e globalmente única.
- `reference_id` é uma FK para outro movimento e não pode apontar para o próprio registro.
- Origem e destino, quando ambos informados, devem ser diferentes.
- `created_by` é obrigatório.
- Triggers bloqueiam `UPDATE` e `DELETE` para qualquer papel, tornando a tabela append-only.
- Cada produto aceita no máximo um movimento `MIGRATION_OPENING_BALANCE`.

### Motor transacional

As funções públicas são a única API de escrita de estoque:

| Operação                          | Movimento                           | Efeito no saldo central | Roles                 |
| --------------------------------- | ----------------------------------- | ----------------------- | --------------------- |
| `receive_stock`                   | `PURCHASE_ENTRY`                    | soma                    | ADMIN, STOCK_OPERATOR |
| `consume_stock`                   | `CONSUMPTION_EXIT`                  | subtrai                 | ADMIN, STOCK_OPERATOR |
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
edição e exclusão. A captura automática de eventos ainda não foi criada.

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

Todas as 18 tabelas possuem RLS e pelo menos uma policy explícita. `anon` permanece sem privilégios
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

## Testes locais

`tests/integration/database-schema.test.ts` inicia PostgreSQL embutido via PGlite, simula apenas os
objetos Supabase externos necessários (`auth.users`, `anon`, `authenticated`), executa todas as
migrations em ordem e testa o catálogo e as invariantes.

Os testes alternam entre `anon` e `authenticated`, simulam o `auth.uid()` de admin, operador,
visualizador, usuário sem role e perfil inativo, e executam consultas/mutações reais sob RLS. Storage
é validado ao aplicar a migration em Supabase, pois suas tabelas pertencem à plataforma e não ao
PostgreSQL embutido.

`tests/integration/stock-engine.test.ts` executa as seis RPCs no PostgreSQL, cobrindo entrada,
consumo, perda, ajustes, abertura legada, transferência, concorrência, replay idempotente, conflito
de chave, rollback forçado, estoque negativo e usuários sem autorização.

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
