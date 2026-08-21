# Migração e importação de dados

## Contexto

O sistema legado contém mais de 600 produtos, mas nomes de tabelas, colunas, IDs, relacionamentos,
tipos e formato de exportação são desconhecidos. A implementação não contém aliases de cabeçalhos
legados e não tenta adivinhar que `COD`, `CODIGO` ou qualquer outro nome significa SKU.

O Bloco 2 implementa leitura, descoberta de cabeçalhos, staging e dry-run. O Bloco 3 amplia esse
domínio com ValueMapping configurável, validação estruturada, categorias candidatas, identificação
segura de produtos e uma barreira de confirmação. O Bloco 5 fornece o motor de estoque e o Bloco 6
implementa a promoção definitiva e transacional de produtos.

## Fluxo implementado

```text
arquivo CSV/XLSX
  → validação de tipo e limites
  → leitura segura
  → SHA-256
  → descoberta de cabeçalhos
  → detecção de duplicidade do arquivo
  → import_batches + import_rows (staging atômico)
  → ColumnMapping explícito
  → ValueMapping configurável
  → normalização e validação estruturada
  → consulta somente-leitura de categorias e identidades
  → candidatos, sugestões, classificação e conflitos
  → dry-run persistido somente no staging
  → barreira de confirmação
  → confirmação administrativa do lote
  → categorias + produtos + mapeamentos
  → movimentos pelo motor transacional
  → relatório e status COMPLETED
```

O port `ImportStagingRepository` continua restrito ao lote, linhas e análise. O port separado
`ImportConfirmationRepository` não oferece escrita direta: sua implementação chama apenas
`confirm_product_import`. Produtos e saldos nunca são alterados pelo parser, dry-run ou frontend.

O acesso remoto a `import_batches`, `import_rows`, `external_entity_mappings` e ao bucket privado
`import-files` exige perfil ativo com role `ADMIN`. `VIEWER`, `STOCK_OPERATOR`, usuários sem role e
anônimos não recebem acesso ao staging ou aos arquivos.

## Estrutura do módulo

- `domain`: tipos canônicos, `ColumnMapping`, normalização, validação e erros.
- `parsers`: leitores CSV/XLSX e descoberta de cabeçalhos.
- `application`: casos de uso `stageImportFile`, `runImportDryRun` e `confirmProductImport`.
- `ports`: contratos para staging, consultas somente-leitura e confirmação transacional.
- `infrastructure`: hash de arquivo e adaptador da RPC de confirmação Supabase.
- `config`: limites seguros e configuráveis.

O módulo não importa React e sua API pública está em `src/modules/data-import/index.ts`.

## Mapeamento de colunas

Toda coluna descoberta exige uma decisão explícita. Ela deve apontar para um campo canônico ou para
`IGNORE`. Não mapear uma coluna é erro; isso impede que novos campos do legado sejam descartados
silenciosamente.

```ts
const mapping: ColumnMapping[] = [
  { sourceColumn: 'COD', targetField: 'sku' },
  { sourceColumn: 'DESCRICAO', targetField: 'name' },
  { sourceColumn: 'COD_BARRAS', targetField: 'ean' },
  { sourceColumn: 'ID_ANTIGO', targetField: 'external_id' },
  { sourceColumn: 'SALDO_ATUAL', targetField: 'opening_quantity' },
  { sourceColumn: 'ESTOQUE_MINIMO', targetField: 'minimum_quantity' },
  { sourceColumn: 'UNID', targetField: 'unit' },
  { sourceColumn: 'GRUPO', targetField: 'category' },
  { sourceColumn: 'TIPO', targetField: 'product_type' },
  { sourceColumn: 'PRECO_COMPRA', targetField: 'IGNORE' },
];
```

Os nomes acima são apenas um mapeamento fornecido pelo usuário. Eles não estão codificados nos
parsers. Os destinos obrigatórios são `sku`, `name`, `unit`, `category` e `product_type`;
`ean`, `external_id`, `opening_quantity` e `minimum_quantity` são opcionais.

Um destino só pode receber uma coluna. Cabeçalhos vazios, duplicados por caixa/Unicode ou não
decididos impedem o processamento.

## Segurança dos arquivos

### CSV

O parser usa uma máquina de estados e não executa conteúdo. Ele:

- detecta `,`, `;`, tab ou `|`, com opção de seleção explícita;
- suporta campos entre aspas, aspas escapadas e quebras de linha internas;
- rejeita aspas não fechadas, caracteres após fechamento e colunas excedentes;
- usa decoding fatal e suporta UTF-8, UTF-16 LE/BE por BOM e Windows-1252 explícito;
- rejeita bytes nulos, encoding inválido e valores semelhantes a fórmulas;
- preserva células vazias como `null`.

### XLSX

O leitor não usa engine de cálculo. Antes de descompactar, inspeciona o diretório central ZIP e
rejeita:

- assinatura, diretório ou XML inválido;
- ZIP multipartes, ZIP64, entradas criptografadas e compressão desconhecida;
- caminhos absolutos, `..`, nomes duplicados e encoding inválido;
- quantidade de entradas, tamanho expandido, tamanho por entrada ou taxa de compressão acima dos
  limites;
- `DOCTYPE` e entidades XML;
- macros, ActiveX, objetos incorporados, links externos e conexões;
- células com fórmulas, mesmo quando o arquivo contém resultado calculado em cache;
- erros de célula, colunas excedentes e dados além do cabeçalho;
- múltiplas planilhas com dados sem seleção explícita.

Strings compartilhadas e inline, números, booleanos e datas textuais são lidos como texto. Nenhum
macro, fórmula ou conteúdo ativo é executado.

Arquivos `.xls` binários não são aceitos.

## Limites padrão

| Limite                    |     Padrão |
| ------------------------- | ---------: |
| Arquivo                   |     10 MiB |
| Linhas de dados           |     10.000 |
| Colunas                   |        200 |
| Caracteres por célula     |     10.000 |
| Entradas internas XLSX    |      5.000 |
| XLSX expandido total      |     50 MiB |
| Entrada XLSX expandida    |     25 MiB |
| Taxa máxima de compressão |      200:1 |
| Chunk de staging          | 500 linhas |

Todos são configuráveis, validados como inteiros positivos e aplicados novamente aos bytes
efetivamente lidos. Os padrões acomodam a migração esperada de 600 produtos sem permitir arquivos
arbitrariamente grandes.

## Hash e repetição

O SHA-256 é calculado sobre os bytes originais antes do parsing. O pipeline consulta o staging por
hash e bloqueia repetição. Reprocessar exige `allowDuplicateOfBatchId` igual ao lote original.

A migration do Bloco 2 adiciona `duplicate_of_batch_id` e um índice único parcial. Isso também
protege contra concorrência: lotes ativos/originais com o mesmo hash não podem ser criados em
paralelo. Reprocessamentos autorizados mantêm referência ao lote anterior.

## Staging e rastreabilidade

`import_batches` passa a guardar tamanho do arquivo, cabeçalhos detectados, opções do parser,
mapeamento, versão, resumo de dry-run e referência de duplicidade. `import_rows` recebe ação do
dry-run e espaço para hash da linha.

O dado original permanece em `raw_data`. O mapeamento nunca o substitui; resultados vão para
`normalized_data`, `validation_errors`, `validation_status`, `dry_run_action` e
`resolved_entity_id`.

## Normalização

- Unicode é normalizado e espaços externos/internos são tratados.
- SKU é normalizado para caixa alta para comparação, sem conversão numérica que removeria zeros.
- Unidades e tipos usam `ValueMapping` configurável. O projeto fornece padrões iniciais, mas o lote
  pode acrescentar ou substituir aliases sem alterar código.
- Quantidades são processadas como texto decimal exato e emitidas com três casas.
- Quantidade atual e quantidade mínima rejeitam negativos, mais de 15 dígitos inteiros e mais de
  três casas; não existe arredondamento silencioso nem uso de `FLOAT`.
- EAN aceita somente GTIN-8, GTIN-12, GTIN-13 ou GTIN-14 com dígito verificador GS1 válido.
- Valores vazios obrigatórios e aliases desconhecidos geram erros por campo.

Exemplo de configuração, independente dos nomes das colunas:

```ts
const valueMappings = {
  unit: [
    { sourceValue: 'UND', targetValue: 'UN' },
    { sourceValue: 'KGS', targetValue: 'KG' },
  ],
  productType: [
    { sourceValue: 'B', targetValue: 'RAW' },
    { sourceValue: '2', targetValue: 'FRACTIONATED' },
  ],
};
```

Configurações contraditórias para o mesmo valor normalizado são rejeitadas; o sistema não escolhe
uma conversão silenciosamente.

## Categorias

Uma categoria encontrada por nome normalizado é reutilizada. Nenhuma correspondência produz uma
`CategoryCandidate` em estado `WARNING`; mais de uma correspondência produz `CONFLICT`. A criação
da candidata precisa ser aprovada explicitamente e continua sem ocorrer durante o dry-run.

## Identificação segura de produtos

O port somente-leitura retorna evidências com a prioridade semântica:

1. `external_entity_mappings` para o sistema de origem e ID externo;
2. SKU exato normalizado;
3. EAN exato e previamente validado;
4. outro identificador inequívoco fornecido por uma integração futura.

Evidências seguras que apontam para produtos diferentes formam conflito crítico, mesmo que uma
delas tenha prioridade maior. Isso evita ocultar corrupção de identificadores. Descrição semelhante
gera apenas `ProductSuggestion`, estado `WARNING` e ação `NEW`; nunca preenche
`resolved_entity_id` e nunca executa merge automático.

## Problemas estruturados

Cada problema contém `rowNumber`, `field`, `value`, `problem`, `suggestedCorrection`, `code` e
`severity`. Assim, a futura interface pode apresentar linha, campo, valor original, motivo e uma
correção acionável sem reconstruir mensagens a partir de texto livre.

## Dry-run

O dry-run consulta categorias e produtos através de ports somente-leitura. Ele não grava entidades
oficiais. Apenas o resultado da análise pode ser persistido no staging.

O resumo contém exatamente:

- `TOTAL`: todas as linhas após o cabeçalho;
- `VALID`: `NEW + UPDATE_CANDIDATE`;
- `INVALID`: linhas no estado `ERROR`;
- `NEW`: SKU válido sem produto existente;
- `UPDATE_CANDIDATE`: SKU correspondente com diferenças ou quantidade inicial informada;
- `CONFLICT`: SKU repetido no arquivo, correspondência ambígua ou resolução inválida;
- `IGNORED`: linha vazia, decisão explícita de ignorar ou registro idêntico ao existente.

Invariante: `TOTAL = VALID + INVALID + CONFLICT + IGNORED`.

O estado por linha é separado da ação:

- `VALID`: linha importável sem ressalvas;
- `WARNING`: linha importável que exige atenção, como categoria candidata ou nome semelhante;
- `ERROR`: valor obrigatório ausente, EAN inválido, quantidade negativa ou ValueMapping ausente;
- `CONFLICT`: identificadores contraditórios, duplicidade ou decisão inválida;
- `IGNORED`: linha vazia, decisão explícita ou registro idêntico.

Quantidade inicial em `UPDATE_CANDIDATE` é apenas uma proposta até a confirmação. Em
`INITIAL_MIGRATION`, ela chama `apply_migration_opening_balance` e cria
`MIGRATION_OPENING_BALANCE` vinculado ao lote; nunca atualiza saldo diretamente.

## Resolução de conflitos

O domínio aceita decisões rastreáveis por número da linha:

- `IGNORE`;
- `REPLACE_SKU`, seguido de nova normalização, verificação de duplicidade e consulta;
- `USE_EXISTING`, aceito somente quando o produto escolhido corresponde ao SKU normalizado.

O dry-run é recalculado após as decisões. Mais de uma resolução para a mesma linha ou uma referência
incompatível permanece como conflito.

Categorias inexistentes usam decisão separada por nome normalizado. A lista
`approvedCategoryCreations` aprova somente a futura criação; não grava a categoria no dry-run.

## Confirmação e promoção

`assertImportConfirmable` é a barreira pura usada antes da chamada remota. Ela rejeita lotes
com qualquer linha `ERROR` ou `CONFLICT` e também rejeita candidaturas de categoria não aprovadas.
Avisos de nome semelhante não fazem merge: a linha permanece `NEW` para uma decisão humana.

A RPC repete essas verificações no banco e adiciona validações contra preview obsoleto, duplicidade
de SKU/EAN/ID externo e correspondências divergentes. `INITIAL_MIGRATION` cria saldo apenas como
primeiro movimento do produto. `MASTER_DATA_IMPORT` exige opção explícita se a quantidade estiver
presente; reconciliar cria `ADJUSTMENT_POSITIVE` ou `ADJUSTMENT_NEGATIVE` vinculado ao lote.

O lote é confirmado em uma transação única. Uma falha na última linha desfaz inclusive categorias,
produtos e movimentos criados nas primeiras linhas. Um lote `COMPLETED` é replayável somente com as
mesmas opções e nunca produz novos efeitos.

Cada criação e mudança relevante do lote gera auditoria. A confirmação registra em `audit_logs` o
`import_batch_id`, nome original do arquivo, hash, usuário, instante, total de linhas e relatório
estruturado. Esses campos são produzidos pelo banco a partir do lote oficial; o cliente não envia
payload livre ao logger. Movimentos de abertura e reconciliação continuam em `stock_movements` e são
correlacionados ao mesmo lote nos eventos de auditoria.

## Testes

Os testes cobrem CSV e XLSX válidos, descoberta de cabeçalhos arbitrários, `IGNORE`, encoding,
arquivos inválidos, fórmulas, limites, compressão suspeita, múltiplas planilhas, hash duplicado,
normalização decimal, aliases padrão e customizados, EAN, quantidade mínima, problemas estruturados,
categorias candidatas e sua aprovação, identificação por ID externo/SKU/EAN, sugestões por nome sem
merge, identificadores contraditórios, barreira de confirmação e resolução por substituição de SKU.
As migrations também são executadas integralmente em PostgreSQL embutido. A confirmação usa uma
fixture de 220 linhas, além de cenários de associação, atualização, reconciliação, replay, rollback e
autorização.

## Importação operacional futura

O fluxo operacional é identificado em `import_batches.operational_import_type` e não reutiliza
`INITIAL_MIGRATION`. Os tipos autorizados são `PRODUCTS`, `CATEGORIES`, `LOCATIONS`, `SUPPLIERS` e
`STOCK_RECONCILIATION`. Todos reutilizam os parsers seguros, SHA-256, staging e mapeamento manual de
colunas; nenhum cabeçalho externo é presumido.

Modelos oficiais podem ser gerados em CSV UTF-8 com BOM ou XLSX sem fórmulas. O modelo de produtos
usa `SKU`, `EAN`, `PRODUTO`, `CATEGORIA`, `TIPO`, `UNIDADE` e `QUANTIDADE_MINIMA`. Os modelos XLSX
incluem instruções, filtros, cabeçalho congelado e validações para enumerações.

Importações de cadastro recusam `opening_quantity` e `current_quantity` no TypeScript e na RPC de
staging. Produtos existentes só são candidatos a atualização por SKU/EAN inequívoco e a alteração
continua opt-in. Categorias novas exigem aprovação. Conflitos podem ser ignorados ou associados
explicitamente a uma entidade existente; a decisão permanece no staging e recalcula o dry-run.

`STOCK_RECONCILIATION` exige SKU ou EAN e `current_quantity`. O preview persiste, como texto decimal
exato, o saldo do sistema, a quantidade do arquivo, a diferença e o movimento proposto. A
confirmação exige `ADMIN`, local `STOCK`, chave idempotente e o motivo literal
`Reconciliação via importação`. Todos os produtos são bloqueados em ordem estável e os saldos são
comparados novamente com o snapshot antes de criar qualquer movimento. Preview obsoleto aborta o
lote integralmente.

Diferença positiva chama o motor com `ADJUSTMENT_POSITIVE`; diferença negativa usa
`ADJUSTMENT_NEGATIVE`; zero não cria movimento. Todo ajuste recebe `import_batch_id`, motivo e chave
determinística por linha. A função nunca executa `UPDATE stock_balances`: movimento e saldo são
confirmados atomicamente pelo motor. Replay devolve o relatório anterior e uma falha em qualquer
linha desfaz movimentos, promoções e conclusão do lote.

## Assistente administrativo de importação

A rota `/importacoes`, protegida pela permissão `MANAGE_IMPORTS`, implementa o fluxo visual em dez
etapas: upload, identificação de colunas, mapeamento de colunas, mapeamento de valores, validação
local, preview, dry-run persistido, resolução de pendências, confirmação e resultado. Cada coluna
descoberta inicia como `IGNORE`; o usuário precisa escolher explicitamente o destino e nenhum nome
de cabeçalho externo é interpretado automaticamente.

O modo `INITIAL_MIGRATION` permite mapear `opening_quantity`. O modo `MASTER_DATA_IMPORT` remove esse
destino da interface e também é recusado no domínio e em `stage_product_import_preview` caso um
cliente manipulado envie quantidade. Quantidades iniciais confirmadas continuam passando por
`confirm_product_import` e `apply_migration_opening_balance`; o navegador não recebe um caminho de
escrita para `stock_balances`.

O navegador faz parsing e normalização segura para apresentar feedback imediato, mas o dry-run
oficial é criado atomicamente no PostgreSQL por `stage_product_import_preview`. Essa RPC repete
autorização, limites, integridade do mapeamento, EAN, decimais, duplicidade do arquivo e dos
identificadores. `get_product_import_preview` devolve páginas de no máximo 500 linhas e não expõe
acesso geral ao staging. Ambas exigem perfil ativo com role `ADMIN`.

Categorias inexistentes precisam de aprovação explícita. Identificadores seguros contraditórios
precisam ser associados manualmente a um produto ativo ou ignorados. Sugestões por nome permanecem
avisos e nunca fazem merge. Depois das decisões, `resolve_operational_import` recalcula o resumo e o
lote só chega a `READY` quando não existem erros, conflitos ou categorias pendentes. A ação final
também verifica `INVALID = 0`, `CONFLICT = 0`, aceite de impacto e, quando aplicável, um local ativo
de estoque.

O resultado informa criados, associados, atualizados, categorias, movimentos, ignorados, warnings,
erros, data, duração e UUID do lote. O relatório baixável é CSV UTF-8 com BOM e
`export_schema_version = 1`; não contém tokens, credenciais ou conteúdo de autenticação.
