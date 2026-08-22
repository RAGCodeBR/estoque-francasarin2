# Revisão final de produção

Data da revisão: 21 de agosto de 2026

Projeto Supabase: `ajavcacdczsgjmtbapxv` (`estoque-v2-dev`, PostgreSQL 17.6, região `sa-east-1`)

Escopo: aplicação React/TypeScript, banco, migrations, Auth/RLS, estoque, notas, importação,
exportação, auditoria, relatórios, backup/restore, performance, interface, dependências e testes.

## Classificação

**NOT READY**

O código e as migrations não apresentaram falha CRITICAL ou HIGH aberta nos gates executados. O
motor de estoque, a autorização e a migração simulada possuem evidências fortes. A liberação para
produção, porém, não deve ocorrer amanhã porque ainda faltam condições operacionais que não podem
ser substituídas por testes locais:

1. não existe backup físico disponível, PITR está desabilitado e não há evidência de um backup
   lógico externo restaurado com sucesso;
2. a migração dos dados reais de 600+ produtos ainda não passou por análise, dry-run e ensaio em
   ambiente isolado;
3. não há configuração de hosting/deploy ou CI no repositório, nem E2E autenticado em navegador
   contra um ambiente Supabase de teste/publicado.

Esta classificação avalia prontidão operacional, não apenas compilação. Depois que os três itens
forem concluídos e as validações deste documento forem repetidas, a expectativa razoável é
**READY WITH WARNINGS**, sujeita aos resultados encontrados nesse novo ensaio.

## Resumo executivo

### Evidências aprovadas

- As 22 migrations versionadas locais constam aplicadas no projeto remoto, sem divergência na lista
  da Supabase CLI.
- O projeto remoto estava `ACTIVE_HEALTHY` no momento da inspeção.
- ESLint, TypeScript strict, Prettier, testes e build de produção passaram.
- Foram aprovados 270 testes: 139 unitários, 122 de integração e 9 classificados no projeto como
  E2E.
- `npm audit` completo e `npm audit --omit=dev` retornaram zero vulnerabilidades conhecidas.
- Não foram encontrados `any` explícitos, `console.log`, `TODO`/`FIXME` acionáveis,
  `dangerouslySetInnerHTML`, `eval` ou `new Function` no código auditado.
- `.env.local` está ignorado pelo Git e contém somente os nomes das variáveis públicas
  `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Não foi encontrada credencial
  administrativa no frontend.
- Não existe escrita de `stock_balances` ou `stock_movements` no React. As únicas mutações SQL
  oficiais dessas tabelas estão concentradas em `private.execute_stock_movement`.
- Todas as tabelas públicas da aplicação têm RLS e policies. `anon` não executa funções da
  aplicação; os helpers privados executáveis por `authenticated` são somente os três usados por
  RLS.
- Todas as funções `SECURITY DEFINER` têm `search_path = pg_catalog`.
- O login foi verificado localmente em 1440x900 e 390x844, sem overflow horizontal ou erros no
  console. A rota `/dashboard` redirecionou uma sessão anônima para `/login`.

### Bloqueadores de liberação

| ID    | Severidade operacional | Situação | Evidência / impacto                                                                                                                                                       | Ação de saída                                                                                                                                                                       |
| ----- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-01 | HIGH                   | Aberto   | `supabase backups list` retornou `walg_enabled=true`, `pitr_enabled=false` e `backups=[]`. Um runbook sem artefato restaurado não prova recuperação.                      | Criar backup lógico PostgreSQL + Storage em destino externo criptografado, validar hashes e executar restore completo em projeto de teste. Formalizar RPO/RTO e decidir PITR/plano. |
| PR-02 | HIGH                   | Aberto   | O arquivo legado real ainda não foi analisado. Os 650 produtos são fixture simulada, não evidência sobre colunas, duplicidades e saldos reais.                            | Preservar cópia somente leitura, calcular hash, gerar relatório do Bloco 25, executar dry-run e confirmar primeiro em ambiente isolado.                                             |
| PR-03 | HIGH                   | Aberto   | Não há hosting/deploy/CI versionado nem URL publicada validada. Não foi testado login e fluxo operacional completo em navegador com ADMIN, STOCK_OPERATOR e VIEWER reais. | Publicar ambiente de homologação, configurar Auth redirects/headers, criar CI e executar smoke/E2E autenticado antes do corte.                                                      |

Nenhum desses itens foi corrigido automaticamente: backup, restore, migração real e publicação
dependem de dados, infraestrutura e decisões explícitas do responsável.

## Banco, migrations e integridade

### Estado verificado

- 22 migrations locais e remotas em correspondência um a um.
- PostgreSQL remoto 17.6; migrations também foram aplicadas em ordem em PGlite nos testes de
  catálogo e integração.
- Tabelas históricas usam referências restritivas; cadastros com histórico são inativados.
- Quantidades de negócio usam `NUMERIC(18,3)` e constraints impedem valores negativos ou
  arredondamento silencioso.
- Nenhuma view pública foi encontrada no catálogo de testes, eliminando uma rota comum de bypass de
  RLS.
- Foreign keys e consultas de escala têm índices documentados e exercitados. Não foi identificado
  índice ausente classificado como erro/warning pelo Performance Advisor.

### Supabase Database Linter

`supabase db lint --linked --schema public --level warning --fail-on none` não retornou erro, mas
retornou sete avisos de PL/pgSQL:

- cinco conversões implícitas de `text` para enum em `review_nfe_import`, `review_pdf_invoice` e
  `confirm_product_import`;
- duas variáveis não lidas: `actor_id` em `review_nfe_import` e `existing_mapping_id` em
  `confirm_product_import`.

Classificação: **LOW**. Os testes funcionais passam, mas as conversões devem se tornar explícitas e
as variáveis mortas devem ser removidas em migration futura, sem alterar migrations já aplicadas.

## Auth, roles, RLS e RPCs

### Aprovado

- Autorização deriva de `profiles`, `roles` e `user_roles`; `user_metadata` não concede acesso.
- As roles `ADMIN`, `STOCK_OPERATOR` e `VIEWER` são testadas separadamente, inclusive usuário
  inativo e sessão `authenticated` sem role.
- `VIEWER` e anônimo não movimentam estoque nem acessam staging administrativo.
- Nem mesmo `ADMIN` recebe `UPDATE`/`DELETE` direto em `stock_movements` ou escrita direta em
  `stock_balances`.
- Escritas genéricas em `import_batches`, `import_rows` e `external_entity_mappings` foram revogadas;
  staging é alterado apenas pelas RPCs validadas.
- Buckets de importação, XML e PDF são privados, limitados e protegidos por role/pasta do usuário.

### Advisors de segurança

O Security Advisor remoto mostrou:

- **0 errors**;
- **38 warnings**;
- **0 info**.

Dos 38 warnings, 37 são o aviso genérico de que usuários autenticados podem chamar funções
`SECURITY DEFINER`. Essa exposição é intencional nas RPCs da aplicação, mas não é tratada como
autorização: cada fronteira relevante valida usuário/role no banco, `anon` não possui EXECUTE,
helpers privados estão revogados e o `search_path` está fixo. O alerta permanece como superfície a
revisar sempre que uma RPC for adicionada; um simples `GRANT EXECUTE TO authenticated` nunca deve ser
aceito sem a validação interna correspondente.

O aviso restante é **Leaked Password Protection Disabled**. Classificação: **MEDIUM**. Habilitar a
proteção antes da produção e avaliar MFA obrigatório para administradores. Referência:
[Password security](https://supabase.com/docs/guides/auth/password-security).

## Transações, concorrência e idempotência

### Aprovado

- Uma função privada central executa autorização, validação, locks, movimento, saldo e auditoria na
  mesma transação.
- Locks consultivos por chave de idempotência e produto, combinados com `FOR UPDATE`, serializam
  saídas concorrentes.
- Saldo negativo é rejeitado antes do commit.
- A mesma `idempotency_key` com o mesmo payload retorna o efeito anterior; payload ou usuário
  diferente é rejeitado.
- Falha forçada entre criação do movimento e atualização do saldo reverte movimento, saldo e
  auditoria.
- Operações em lote adquirem locks em ordem estável e preservam all-or-nothing.
- Ajustes, perdas, inventários, NF-e XML/PDF e reconciliação chamam o motor; nenhum deles atualiza
  saldo diretamente.

## `MIGRATION_OPENING_BALANCE`

### Rastreabilidade aprovada

- A abertura exige `ADMIN`, produto ativo, local `STOCK`, `import_batch_id`, chave idempotente e
  motivo fixo `Migração sistema legado`.
- O movimento deve ser o primeiro histórico do produto e o saldo anterior deve ser zero.
- Existe índice único parcial que aceita no máximo um `MIGRATION_OPENING_BALANCE` por produto.
- O movimento guarda `import_batch_id`, usuário, timestamp, saldo anterior/posterior e
  `idempotency_key`.
- `stock_balances.last_movement_id` aponta para o movimento que produziu o saldo.
- A fixture de migração confirmou 650 produtos, 650 saldos e 650 movimentos de abertura; todos os
  saldos apontaram para seu movimento. Reexecutar o mesmo batch retornou `applied=false` e não
  duplicou produto, categoria, saldo ou movimento.

Quantidade externa nunca usa `UPDATE stock_balances = quantidade_arquivo`:

- `INITIAL_MIGRATION` chama `apply_migration_opening_balance`;
- importação cadastral comum recusa/ignora quantidade conforme o contrato;
- `STOCK_RECONCILIATION` compara preview e saldo atual, bloqueia produtos e cria
  `ADJUSTMENT_POSITIVE` ou `ADJUSTMENT_NEGATIVE` vinculado ao batch.

Observação: quantidade inicial exatamente zero não cria movimento nem linha de saldo. Isso é
coerente com o motor atual, mas deve constar na regra de aceite da migração real para evitar a
expectativa de um movimento `+0`, que o domínio proíbe.

## Notas, importações e exportações

### Aprovado

- XML rejeita DTD/entidades, encodings e estruturas inválidas, limita tamanho e não associa por
  descrição.
- PDF permanece assistido, limita páginas/bytes/texto, desabilita execução dinâmica e exige revisão
  humana antes de estoque.
- Nota confirmada cria invoice, itens e movimentos atomicamente; chave de acesso/idempotência impede
  duplicidade.
- CSV/XLSX passam por detecção de cabeçalhos, mapeamento, normalização, staging, validação, preview e
  dry-run.
- Arquivos e linhas possuem limites configurados; XLSX não executa fórmulas nem aceita macro/links
  externos como dados confiáveis.
- Linhas com conflito crítico impedem confirmação. Nome parecido só gera sugestão.
- Exportações usam schemas fechados, paginação, `export_schema_version = 1` e sanitização contra
  CSV/XLSX formula injection. Campos secretos são rejeitados.
- O teste de portabilidade separa cadastro de produto e reconciliação de saldo.

### Risco de UX

O parser de importação ainda processa até 10.000 linhas na thread principal. O limite e o teste de
tempo evitam carga ilimitada, mas arquivos frequentes desse porte podem causar pausa perceptível em
equipamentos modestos. Classificação: **MEDIUM**, não quebra de consistência. Manter monitoramento e
migrar parsing para Worker se o p95 real justificar.

## Performance e escalabilidade

### Aprovado

- Paginação e filtros são executados no banco; páginas públicas têm limite rígido.
- Testes cobrem 1.000 produtos, 10.000 linhas de staging/importação, paginação profunda controlada e
  payload limitado.
- Relatórios/dashboard usam agregações no PostgreSQL e não carregam coleções completas no React.
- Importação e estoque priorizam consistência; locks são adquiridos em ordem estável.
- O build usa code splitting. Bundle principal: 478,79 kB bruto / 138,99 kB gzip; PDF permanece em
  chunk lazy de 452,56 kB bruto / 136,39 kB gzip.

### Advisor de performance

O Performance Advisor remoto mostrou:

- **0 errors**;
- **0 warnings**;
- **79 info**, observados como índices ainda não utilizados.

O banco está praticamente sem carga e sem estatísticas de uso representativas. Esses índices dão
suporte a filtros, joins e históricos projetados para o crescimento; removê-los antes de tráfego real
seria prematuro. Reavaliar após carga/migração usando `pg_stat_statements`, planos e estatísticas. A
lista oficial de checks está em [Database Advisors](https://supabase.com/docs/guides/database/database-advisors).

## Interface, responsividade e tratamento de erro

### Aprovado

- Shell desktop-first com breakpoints 1350, 1100, 1000, 960 e 760 px.
- Tabelas largas e etapas do importador usam overflow horizontal controlado.
- A navegação lateral vira off-canvas em tablet/celular; dialogs e ações viram coluna.
- Existe tratamento para loading, erro, vazio, notificações e erro fatal.
- O smoke local confirmou login desktop e celular, sem overflow horizontal ou warning/error do app.
- Guards redirecionam anônimo; esconder rota/botão não é a autorização efetiva.

### Limites da verificação

- Não foi possível validar páginas autenticadas responsivas sem usar senha do usuário.
- Os testes em `tests/e2e` são jornadas de banco/domínio em PGlite e serialização/importação em
  processo. Eles não são E2E de navegador e não exercitam rede, Auth real, Storage real ou hosting.
- Não há teste automatizado de acessibilidade, matriz de navegadores ou headers de segurança do host.

Classificação: **MEDIUM** e bloqueador de release enquanto não houver homologação publicada.

## Código e manutenibilidade

- Nenhum `any` explícito ou regra crítica duplicada no React foi localizado.
- Há um único `console.error`, deliberado no `ErrorBoundary`; não existe `console.log` de depuração.
- O bootstrap de PGlite (`runMigrations` + schemas Auth/Storage) está duplicado em 16 arquivos de
  teste. Classificação: **LOW**; extrair fixture compartilhada reduzirá custo de manutenção.
- `ImportWizardPage.tsx` possui 1.375 linhas. O fluxo funciona e está testado, mas deve ser dividido
  por etapas/hooks antes de crescer. Classificação: **LOW**.
- Não foi encontrada configuração de CI, deploy ou hosting no repositório. Este item integra PR-03.

## Dependências

- `npm audit`: 0 vulnerabilidades em 289 dependências totais.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- Árvore instalada válida; dependências opcionais ausentes são específicas de plataforma/features
  não usadas.
- Existem versões mais novas de ESLint e majors de PDF.js/TypeScript. Não atualizar na véspera da
  produção sem ciclo próprio de compatibilidade. O lockfile fixa o estado aprovado.

Uma auditoria de registry não demonstra ausência absoluta de risco de supply chain. Renovar o
`npm audit`, revisar changelogs e usar CI com instalação reproduzível antes de cada release.

## Backup e restore

O runbook e os scripts são defensivos: não restauram produção, não aceitam segredo na linha de
comando, geram hashes e separam PostgreSQL de Storage. Os testes unitários desses scripts passam.

O estado operacional, entretanto, não está pronto:

- WAL-G da plataforma: habilitado;
- PITR: desabilitado;
- backups físicos listados: zero;
- backup lógico externo desta revisão: não executado;
- restore completo em projeto isolado: sem evidência;
- backup dos bytes de `import-files`, `invoice-xml` e `invoice-pdf`: sem evidência.

Referência oficial: [Database backups](https://supabase.com/docs/guides/platform/backups). O
procedimento seguro permanece em `docs/backup-restore.md`.

## Gates executados

| Gate                               | Resultado                        |
| ---------------------------------- | -------------------------------- |
| `npm run lint`                     | PASS                             |
| `npm run typecheck`                | PASS                             |
| `npx vitest run tests/unit`        | PASS — 28 arquivos / 139 testes  |
| `npx vitest run tests/integration` | PASS — 15 arquivos / 122 testes  |
| `npx vitest run tests/e2e`         | PASS — 2 arquivos / 9 testes     |
| `npm test`                         | PASS — 45 arquivos / 270 testes  |
| `npm run format:check`             | PASS                             |
| `npm run build`                    | PASS — 394 módulos transformados |
| `npm audit --omit=dev`             | PASS — 0 vulnerabilidades        |
| `npm audit`                        | PASS — 0 vulnerabilidades        |
| migrations local x remoto          | PASS — 22/22                     |
| Supabase Security Advisor          | 0 errors / 38 warnings / 0 info  |
| Supabase Performance Advisor       | 0 errors / 0 warnings / 79 info  |
| Supabase DB lint                   | PASS com 7 warnings LOW          |
| smoke responsivo anônimo           | PASS em 1440x900 e 390x844       |

## Critérios mínimos para reclassificação

Executar nesta ordem:

1. gerar backup lógico externo criptografado do PostgreSQL e dos três buckets;
2. validar manifesto/hash e restaurar em projeto Supabase isolado;
3. executar `validate-restored-database.sql`, Auth/RLS, jornadas de estoque e registrar RPO/RTO;
4. obter o arquivo legado real, preservar original/hash, gerar relatório e resolver mapeamentos;
5. executar dry-run e confirmação da migração no ambiente restaurado/homologação;
6. reconciliar contagens, SKUs/EANs/categorias e cada saldo com
   `MIGRATION_OPENING_BALANCE + import_batch_id`;
7. publicar o frontend em homologação com redirect URLs e headers de segurança revisados;
8. executar E2E de navegador com anônimo, VIEWER, STOCK_OPERATOR e ADMIN, incluindo Storage e
   concorrência contra PostgreSQL real;
9. habilitar leaked-password protection, revisar MFA/admin e repetir Security/Performance Advisors;
10. adicionar CI obrigatório para lint, typecheck, unit, integration, E2E e build;
11. repetir este relatório com evidências datadas e decisão nominal de go/no-go.

## Declaração de limite

Esta revisão reduz incerteza e registra evidências do estado observado. Ela não declara o software
completamente livre de falhas. Testes locais, advisors e análise estática não substituem tráfego real,
restore comprovado, observabilidade, teste do arquivo legado e homologação com usuários/roles reais.
