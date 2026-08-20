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

O motor transacional de estoque, as políticas de acesso e a promoção definitiva da importação ainda
não foram implementados. As tabelas estão em modo default-deny para `anon` e `authenticated`.

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

### `roles` e `user_roles`

Papéis são dados controlados pela aplicação, identificados por código único sem diferenciação de
maiúsculas e espaços externos. `user_roles` relaciona perfis e papéis e registra quem concedeu e
quando. `user_metadata` não participa do modelo de autorização.

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

Essa tabela não tem grants para clientes. Somente o futuro motor transacional poderá alterá-la; não
foi criada API de mutação neste bloco.

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

Todas as 16 tabelas possuem RLS habilitada. A migration de segurança revoga explicitamente todos os
privilégios de tabela de `anon` e `authenticated`, protege o schema `private` e altera privilégios
padrão para novos objetos.

Nenhuma policy permissiva foi criada, porque ainda não existem casos de uso ou matriz de acesso
aprovados. Quando uma tabela precisar ser exposta, uma migration futura deverá conceder somente as
operações necessárias e criar/testar as policies RLS no mesmo conjunto de mudanças.

Estar no schema `public` não é considerado autorização de acesso.

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

Esse teste oferece execução real de PostgreSQL sem credenciais. Antes de implantação, as mesmas
migrations ainda devem ser executadas em um ambiente Supabase isolado para validar integrações da
plataforma, extensões, configuração da Data API e policies futuras.
