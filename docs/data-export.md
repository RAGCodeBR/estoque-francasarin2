# Exportação de dados operacionais

## Objetivo e limite

Este módulo gera arquivos para Excel, Google Sheets, auditoria e portabilidade. Ele não é backup do
PostgreSQL. Uma restauração completa ainda depende de banco, migrações, funções, RLS, Auth, Storage,
segredos de ambiente e procedimento de recuperação testado.

## Tipos disponíveis

- `PRODUCTS`
- `CATEGORIES`
- `LOCATIONS`
- `SUPPLIERS`
- `STOCK_CURRENT`
- `STOCK_MOVEMENTS`
- `LOSSES`
- `INVOICES`
- `PRODUCTS_WITH_CURRENT_STOCK`

Todos preservam UUIDs para correlação e também nomes, códigos, documentos, números fiscais ou locais
humanamente compreensíveis. `PRODUCTS_WITH_CURRENT_STOCK` inclui produto, SKU, EAN, nome, categoria,
tipo, unidade, saldo atual, mínimo, situação e estado ativo.

## Fluxo

```text
tipo + filtros/seleção
→ validação do serviço
→ páginas sanitizadas no PostgreSQL
→ validação contra schema fechado
→ CSV, XLSX ou JSON
→ verificação de tamanho
→ auditoria de conclusão
```

O banco filtra antes de paginar. Ausência de filtros e seleção significa todos os registros dentro
dos limites. Uma lista `selectedIds` restringe a entidade principal: produto, categoria, local,
fornecedor, movimentação, perda ou nota, conforme o tipo.

## Formatos e versionamento

Todo arquivo usa `export_schema_version = 1`.

- CSV: UTF-8 com BOM, separador `;`, fim de linha CRLF, bloco inicial de metadados e coluna de versão.
- XLSX: OpenXML compactado, planilha de dados, planilha de metadados, cabeçalho congelado e filtro.
- JSON: documento técnico com versão, tipo, data, contagem, definição de colunas e linhas.

Valores decimais permanecem texto exato. O XLSX não contém fórmulas, macros, links ou conteúdo
incorporado. Valores perigosos para planilhas são neutralizados no CSV.

## Segurança e limites

Somente `ADMIN` ativo pode consultar ou auditar exportações. Senhas, tokens, secrets, cookies,
credenciais administrativas, dados internos de autenticação, staging bruto e caminhos internos não
fazem parte dos schemas.

Limites padrão:

| Recurso           |            Limite |
| ----------------- | ----------------: |
| Página do banco   |        500 linhas |
| Arquivo           |    100.000 linhas |
| Seleção explícita |      10.000 UUIDs |
| Célula XLSX       | 32.767 caracteres |
| Saída em memória  |            50 MiB |

Se geração, validação de schema, tamanho ou auditoria falhar, o serviço não entrega o artefato como
concluído. O evento de auditoria registra somente tipo, formato, contagem, versão e idempotência.
