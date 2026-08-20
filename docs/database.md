# Banco de dados

## Estado atual

O Bloco 1 cria a modelagem principal nas três primeiras migrations. Os Blocos 2 e 3 adicionam
metadados de staging, dry-run e validação nas migrations seguintes:

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

O motor transacional de estoque e a promoção definitiva da importação ainda não foram implementados.
O acesso pela Data API agora segue uma matriz explícita de roles e permanece default-deny quando não
existe policy permissiva.

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

## Notas fiscais

`invoices` relaciona fornecedor, identificação fiscal, datas, estado, arquivo original e autor. A
`access_key`, quando informada, é única. Itens possuem número de linha único por nota, produto,
código do fornecedor, descrição, quantidade, unidade e valores.

Itens oficiais exigem produto resolvido. Dados ainda não resolvidos permanecem em `import_rows` e
não são promovidos antecipadamente.

## Estoque central

### `stock_balances`

O Bloco 1 adota um único estoque central, conforme solicitado. A PK é `product_id`, portanto existe
um saldo consolidado por produto. A quantidade possui check de não negatividade.

Essa tabela concede somente leitura aos três papéis. Nenhum usuário da aplicação possui `INSERT`,
`UPDATE` ou `DELETE`. Somente o futuro motor transacional poderá alterá-la.

### `stock_movements`

Cada movimento registra produto, tipo, quantidade positiva, locais opcionais, nota, lote de
importação, motivo, referência compensatória, chave de idempotência, autor e data.

- `idempotency_key` é obrigatória e globalmente única.
- `reference_id` é uma FK para outro movimento e não pode apontar para o próprio registro.
- Origem e destino, quando ambos informados, devem ser diferentes.
- `created_by` é obrigatório.
- Triggers bloqueiam `UPDATE` e `DELETE` para qualquer papel, tornando a tabela append-only.

O significado de débito/crédito por tipo e a atualização atômica do saldo pertencem ao motor de
estoque e não foram implementados neste bloco.

## Importação e mapeamentos externos

### `import_batches`

Cada lote registra origem, arquivo, tamanho, hash, cabeçalhos detectados, opções de parser,
ColumnMapping e ValueMapping versionados, categorias aprovadas para criação, resumo do dry-run,
status, contagens, autoria, confirmação e metadados. Checks impedem contagens negativas, contagens
classificadas acima do total e confirmação parcialmente preenchida.

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

### `external_entity_mappings`

A chave natural `(source_system, entity_type, external_id)` é única e aponta para um UUID interno
genérico. Não existe FK polimórfica, pois o PostgreSQL não consegue garantir uma referência que pode
apontar para diferentes tabelas. A validação da entidade e o registro de auditoria serão
responsabilidade do fluxo de mapeamento futuro.

## Auditoria

`audit_logs` comporta ator opcional para eventos do sistema, ação, tipo e ID da entidade, request ID,
estado anterior/novo e metadados. Assim como movimentos, logs de auditoria possuem triggers contra
edição e exclusão. A captura automática de eventos ainda não foi criada.

## Data API e RLS

Todas as 16 tabelas possuem RLS e pelo menos uma policy explícita. `anon` permanece sem privilégios
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

## Índices e integridade

Além das PKs e uniques, existem índices para FKs e consultas previstas por status, hash, EAN,
produto/data do movimento, entidades externas e auditoria. Índices parciais evitam entradas inúteis
para referências opcionais.

Triggers `set_updated_at` mantêm timestamps mutáveis no banco. Constraints expressam as invariantes
conhecidas sem antecipar regras do motor de estoque ou do importador.

## Testes locais

`tests/integration/database-schema.test.ts` inicia PostgreSQL embutido via PGlite, simula apenas os
objetos Supabase externos necessários (`auth.users`, `anon`, `authenticated`), executa todas as
migrations em ordem e testa o catálogo e as invariantes.

Os testes alternam entre `anon` e `authenticated`, simulam o `auth.uid()` de admin, operador,
visualizador, usuário sem role e perfil inativo, e executam consultas/mutações reais sob RLS. Storage
é validado ao aplicar a migration em Supabase, pois suas tabelas pertencem à plataforma e não ao
PostgreSQL embutido.
