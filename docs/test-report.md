# Relatório de testes — Bloco 24

Data da execução: 21 de agosto de 2026

Escopo: testes unitários, integração, E2E, migração simulada em escala, lint, typecheck e build.

## Resultado executivo

**APROVADO.** Todos os 20 cenários solicitados foram exercitados e todos os gates do projeto passaram. Nenhuma funcionalidade de produção foi adicionada neste bloco; as alterações se limitam a testes, massa simulada, configuração de descoberta da suíte E2E e este relatório.

Os testes transacionais executam todas as migrations versionadas em uma instância PostgreSQL compatível e isolada com PGlite. Nenhum dado foi gravado no projeto Supabase remoto durante esta bateria.

## Resultado das suítes

| Gate        | Comando                            | Resultado                         |
| ----------- | ---------------------------------- | --------------------------------- |
| Unitários   | `npx vitest run tests/unit`        | 26 arquivos, 133 testes aprovados |
| Integração  | `npx vitest run tests/integration` | 15 arquivos, 122 testes aprovados |
| E2E         | `npx vitest run tests/e2e`         | 2 arquivos, 9 testes aprovados    |
| Consolidado | `npm test`                         | 43 arquivos, 264 testes aprovados |
| Lint        | `npm run lint`                     | Aprovado, zero warnings           |
| TypeScript  | `npm run typecheck`                | Aprovado                          |
| Build       | `npm run build`                    | Aprovado                          |

O gate consolidado inclui as três camadas por meio do `vitest.config.ts`. Testes parametrizados contam cada combinação como um caso independente.

## Cenários validados

| #   | Cenário                                          | Resultado | Evidência principal                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Criar produto, entrada de 100 KG, saldo 100      | Aprovado  | `tests/e2e/stock-lifecycle.e2e.test.ts`: criação autenticada e `receive_stock`; saldo confirmado em `100.000`.                                                                                                                                                                                                   |
| 2   | Saída de 25, saldo 75                            | Aprovado  | Mesma jornada E2E via `consume_stock`; saldo confirmado em `75.000`.                                                                                                                                                                                                                                             |
| 3   | Perda de 5, saldo 70                             | Aprovado  | Mesma jornada E2E via `register_stock_loss`; saldo confirmado em `70.000`.                                                                                                                                                                                                                                       |
| 4   | Inventário físico 72, ajuste +2, saldo 72        | Aprovado  | Fluxo `DRAFT → COUNTING → REVIEW → CONFIRMED`; nenhum efeito antes da confirmação e movimento `ADJUSTMENT_POSITIVE` de `2.000`.                                                                                                                                                                                  |
| 5   | Confirmar NF e bloquear duplicidade              | Aprovado  | `tests/integration/nfe-receiving.test.ts`: confirmação atômica, replay sem duplicação e rejeição de NF duplicada/chave diferente.                                                                                                                                                                                |
| 6   | Saldo 5, retirada 10                             | Aprovado  | E2E rejeita estoque negativo; saldo permanece `5.000` e nenhum movimento é criado.                                                                                                                                                                                                                               |
| 7   | Concorrência                                     | Aprovado  | Duas retiradas concorrentes de 7 sobre saldo 10: exatamente uma confirma; saldo final `3.000`.                                                                                                                                                                                                                   |
| 8   | `idempotency_key` repetida                       | Aprovado  | Replay retorna o mesmo movimento com `applied = false`; saldo e histórico não duplicam.                                                                                                                                                                                                                          |
| 9   | VIEWER tenta alterar estoque                     | Aprovado  | Operação rejeitada por autorização do banco; nenhum movimento criado.                                                                                                                                                                                                                                            |
| 10  | Anônimo tenta alterar estoque                    | Aprovado  | Execução como role `anon` rejeitada; nenhum movimento criado.                                                                                                                                                                                                                                                    |
| 11  | Erro durante transação                           | Aprovado  | Falha forçada no saldo reverte movimento, saldo e auditoria.                                                                                                                                                                                                                                                     |
| 12  | Arquivo com 600+ produtos simulados              | Aprovado  | CSV real gerado com 650 produtos, cabeçalhos identificados, staging e confirmação. Categorias, tipo, unidade, mínimo e saldo inicial são validados. Foram criados 650 movimentos `MIGRATION_OPENING_BALANCE`; cada `stock_balance.last_movement_id` aponta para o movimento correspondente e não há saldo órfão. |
| 13  | Reexecutar o mesmo `import_batch`                | Aprovado  | Replay do batch retorna `applied = false`; permanecem 650 produtos, mappings, saldos e movimentos únicos.                                                                                                                                                                                                        |
| 14  | SKU duplicado no arquivo                         | Aprovado  | `tests/unit/data-import/import-pipeline.test.ts`: dry-run classifica as linhas duplicadas como conflito e impede confirmação silenciosa.                                                                                                                                                                         |
| 15  | Nome parecido sem identificador seguro           | Aprovado  | `tests/unit/data-import/migration-validation.test.ts`: similaridade gera somente sugestão; nunca resolve ou mescla automaticamente.                                                                                                                                                                              |
| 16  | `UND`, `UNIDADE`, `KG`, `KILO`                   | Aprovado  | Teste parametrizado confirma `UND/UNIDADE → UN` e `KG/KILO → KG` pelo `ValueMapping`.                                                                                                                                                                                                                            |
| 17  | Importação operacional tenta alterar saldo       | Aprovado  | Fluxo PRODUCTS rejeita `current_quantity`; `STOCK_RECONCILIATION` cria movimentos `ADJUSTMENT_POSITIVE/NEGATIVE` ligados ao batch, com motivo canônico e replay idempotente.                                                                                                                                     |
| 18  | Exportar produtos + estoque e reimportar         | Aprovado  | `tests/e2e/data-portability.e2e.test.ts`: exportação `PRODUCTS_WITH_CURRENT_STOCK` v1 é reaberta em ambiente isolado. Cadastro e quantidade seguem fluxos separados; quantidade entra somente em reconciliação.                                                                                                  |
| 19  | Gerar e abrir XLSX                               | Aprovado  | XLSX OpenXML é gerado, descompactado e lido novamente pelo parser; schema, planilha e dados são preservados e não existem células de fórmula executável.                                                                                                                                                         |
| 20  | Gerar CSV com encoding e proteção contra fórmula | Aprovado  | CSV contém BOM UTF-8, texto português, CRLF, `export_schema_version = 1` e neutralização de CSV Injection, inclusive prefixos disfarçados.                                                                                                                                                                       |

## Migração simulada de 650 produtos

A fixture utiliza nomes de colunas de origem independentes do schema novo:

`COD`, `DESCRICAO`, `SALDO_ATUAL`, `UNID`, `GRUPO`, `TIPO`, `MINIMO`, `EAN`, `ID_EXTERNO`.

Foram validados:

- 650 produtos criados;
- 10 categorias criadas;
- 650 mapeamentos externos criados;
- produtos `RAW` e `FRACTIONATED`;
- unidades `KG` e `UN`;
- `minimum_quantity` não negativa;
- EAN preservado quando informado;
- 650 movimentos de abertura vinculados ao mesmo `import_batch_id`;
- 650 saldos iguais ao `balance_after` do respectivo movimento de abertura;
- batch finalizado como `COMPLETED`;
- replay sem qualquer efeito duplicado.

O teste não usa `UPDATE stock_balances SET quantity = valor_importado`. O saldo é consequência exclusiva da confirmação transacional da migração e do movimento `MIGRATION_OPENING_BALANCE`.

## Portabilidade

A compatibilidade de ida e volta foi validada em duas fases intencionais:

1. campos cadastrais da exportação são mapeados para `PRODUCTS`, ignorando explicitamente o saldo;
2. `current_quantity` é mapeada separadamente para `STOCK_RECONCILIATION`.

Essa separação comprova que um arquivo exportado pelo sistema é reaproveitável sem permitir sobrescrita silenciosa do estoque.

## Limites e interpretação

- Os testes de banco são executados em ambiente local descartável, com todas as migrations do repositório. Isso evita poluir o projeto Supabase conectado com produtos e notas fiscais fictícios.
- A massa de 650 produtos é simulada porque o arquivo real do sistema legado ainda não foi fornecido.
- Os testes E2E deste bloco exercitam os fluxos completos de domínio, RPC, RLS e persistência. Não foi necessária automação de navegador para validar regras que pertencem ao backend.
- O teste de concorrência usa chamadas simultâneas contra a mesma instância transacional e verifica o estado persistido após ambas terminarem.

## Conclusão

O Bloco 24 está aprovado no ambiente de teste. As invariantes de estoque, idempotência, atomicidade, autorização, migração, reconciliação e portabilidade permaneceram válidas sob a bateria executada.
