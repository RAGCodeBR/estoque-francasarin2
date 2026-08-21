# Backup e restauração completa

## Escopo e autoridade

Este runbook trata recuperação de desastre do PostgreSQL/Supabase. Ele não é uma exportação de
negócio e não integra o frontend. Somente operadores de infraestrutura explicitamente autorizados
podem criar backups lógicos, acessar os artefatos ou restaurar ambientes.

CSV, XLSX e JSON operacionais não preservam funções, triggers, RLS, grants, Auth, histórico de
migrations ou consistência transacional completa. Eles são úteis para portabilidade, mas não
substituem este procedimento.

Restauração de produção é sempre uma mudança destrutiva com janela, aprovação humana e plano de
retorno. Nenhum script deste repositório restaura produção. O único helper de restore recusa o
project ref produtivo e exige uma confirmação literal para um ambiente de teste novo.

Referências oficiais:

- [Database Backups — Supabase](https://supabase.com/docs/guides/platform/backups)
- [Backup and Restore using the CLI — Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase CLI: db dump](https://supabase.com/docs/reference/cli/v0/supabase-db-dump)
- [PostgreSQL: SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html)
- [PostgreSQL: pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
- [PostgreSQL: pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)

## Estado verificado em 20 de agosto de 2026

| Componente                 | Estado observado                                                  |
| -------------------------- | ----------------------------------------------------------------- |
| Supabase CLI do projeto    | `2.115.0`, instalada localmente via npm                           |
| Comando global `supabase`  | Não está no `PATH`; usar `npx --no-install supabase`              |
| PostgreSQL remoto          | `17.6`                                                            |
| Backup físico/WAL-G        | Habilitado na plataforma (`walg_enabled = true`)                  |
| PITR                       | Desabilitado (`pitr_enabled = false`)                             |
| Backups físicos listados   | Nenhum retornado pela CLI nesta verificação                       |
| `psql`/`pg_dump`/`restore` | Não instalados no Windows                                         |
| Storage usado pelo projeto | `import-files`, `invoice-xml` e `invoice-pdf` quando provisionado |

O estado gerenciado depende do plano e pode mudar. Antes de cada exercício, conferir `Database >
Backups` no Dashboard e `supabase backups list`. A ausência atual de PITR e de backups listados é um
risco: até a política gerenciada ser confirmada, o backup lógico externo é a linha de recuperação
controlada pelo restaurante.

## Pré-voo obrigatório da CLI

Antes de qualquer comando Supabase CLI em uma sessão operacional, executar:

```powershell
supabase --version
supabase --help
supabase db --help
```

Como este repositório usa instalação npm local, o equivalente efetivo é:

```powershell
npx --no-install supabase --version
npx --no-install supabase --help
npx --no-install supabase db --help
```

Depois, consultar o `--help` do subcomando pretendido. Flags não devem ser copiadas de memória. Os
scripts em `scripts/backup` executam esse pré-voo antes do primeiro comando operacional.

## Objetivos recomendados

Enquanto o restaurante não formalizar RPO/RTO contratual:

| Objetivo | Recomendação inicial                                             |
| -------- | ---------------------------------------------------------------- |
| RPO      | 24 horas com dump diário; reduzir para minutos ao habilitar PITR |
| RTO      | 4 horas, medido em exercício real com banco e Storage            |
| Restore  | Teste mensal e antes de mudanças estruturais de alto risco       |
| Cópias   | Regra 3-2-1: três cópias, dois meios, uma cópia externa/isolada  |

PITR reduz o RPO, mas não substitui cópia lógica fora da conta Supabase nem backup dos objetos do
Storage. A exclusão do projeto também remove os backups mantidos pela plataforma.

## 1. Backup lógico

### Conteúdo mínimo

Cada execução deve produzir um conjunto consistente e indivisível:

- `roles.sql`: roles PostgreSQL aplicáveis, sem guardar senhas;
- `schema.sql`: schema, funções, triggers, policies, grants e tipos suportados pelo dump;
- `data.sql`: dados usando `COPY`;
- `history_schema.sql` e `history_data.sql`: schema e linhas de `supabase_migrations`;
- `migrations.zip`: migrations versionadas presentes no commit da aplicação;
- `backup-metadata.json`: origem, instante UTC, CLI, commit e estado `COMPLETE`;
- `manifest.sha256.json`: tamanho e SHA-256 de cada artefato.

O dump é dado altamente sensível: pode conter usuários Auth, dados fiscais, histórico e caminhos de
arquivos. Não pode ser salvo no repositório, OneDrive pessoal não controlado ou diretório público.

### Procedimento preferencial

Usar destino externo criptografado. O helper recusa diretórios dentro do workspace:

```powershell
pwsh -NoProfile -File scripts/backup/backup-database.ps1 `
  -OutputRoot 'E:\backups-criptografados\estoque-fran' `
  -ProjectRef '<PROJECT_REF>'
```

O script usa somente `--project-ref`; não aceita connection string ou senha como argumento. A sessão
da CLI deve ter sido autenticada por mecanismo administrativo seguro. O artefato só recebe
`status = COMPLETE` após todos os dumps e o ZIP de migrations existirem.

### Sequência manual equivalente

Após o pré-voo, executar em um diretório externo novo:

```powershell
npx --no-install supabase db dump --project-ref '<PROJECT_REF>' --file roles.sql --role-only
npx --no-install supabase db dump --project-ref '<PROJECT_REF>' --file schema.sql
npx --no-install supabase db dump --project-ref '<PROJECT_REF>' --file data.sql --use-copy --data-only --exclude 'storage.buckets_vectors' --exclude 'storage.vector_indexes'
npx --no-install supabase db dump --project-ref '<PROJECT_REF>' --file history_schema.sql --schema supabase_migrations
npx --no-install supabase db dump --project-ref '<PROJECT_REF>' --file history_data.sql --use-copy --data-only --schema supabase_migrations
```

Antes da primeira execução real ou após atualizar a CLI, usar `supabase db dump --dry-run` e revisar
o comando gerado. A CLI envolve `pg_dump` em container e exclui schemas gerenciados conforme sua
versão; por isso o conjunto precisa ser testado, não apenas criado.

### Roles

`roles.sql` representa roles do cluster. Senhas de roles customizadas com `LOGIN` não são incluídas
em backups diários e devem ser redefinidas no novo ambiente por segredo gerado no momento do
restore. As roles de aplicação `ADMIN`, `STOCK_OPERATOR` e `VIEWER` são linhas em `public.roles` e
viajam em `data.sql`; não são senhas PostgreSQL.

Nunca escrever uma senha em migration, documentação, `roles.sql` versionado ou comando de shell.

### Migrations

Há duas fontes que devem concordar:

1. arquivos versionados em `supabase/migrations`, preservados pelo Git e por `migrations.zip`;
2. histórico aplicado em `supabase_migrations.schema_migrations`, preservado pelos dumps de
   histórico.

Após restore, comparar `supabase migration list` com o commit registrado no metadata. Não executar
`db push` até resolver qualquer divergência.

## 2. Restauração

### Opção A — backup físico/PITR gerenciado

É a opção preferida para recuperação do mesmo projeto quando disponível. No Dashboard, selecionar o
ponto anterior ao incidente, revisar fuso horário, impacto e indisponibilidade. A plataforma deixa o
projeto inacessível durante o processo. Subscriptions e replication slots customizados precisam ser
tratados antes/depois conforme a documentação; o slot do Realtime é gerenciado pela Supabase.

Listagem é leitura segura:

```powershell
npx --no-install supabase backups list --project-ref '<PROJECT_REF>'
```

`supabase backups restore` é destrutivo. Ele não aparece em scripts automáticos deste projeto e só
pode ser executado por um operador após aprovação formal, snapshot dos objetos do Storage, registro
do timestamp Unix escolhido e confirmação de janela de indisponibilidade.

### Opção B — restore lógico em projeto novo

Pré-requisitos:

1. criar projeto Supabase vazio, nunca reutilizar produção;
2. confirmar PostgreSQL de destino compatível com a origem 17.6;
3. habilitar extensões e Webhooks necessários;
4. instalar cliente `psql` compatível com PostgreSQL 17 e executar `psql --version`;
5. configurar a connection string do teste em secret manager ou variável de ambiente;
6. validar hashes antes de conectar ao destino.

O helper exige que a URL esteja apenas na variável `TEST_RESTORE_DATABASE_URL`, que o project ref de
teste apareça nela, que o ref produtivo não apareça e que a confirmação seja literal:

```powershell
$env:TEST_RESTORE_DATABASE_URL = '<CONNECTION_STRING_DO_PROJETO_DE_TESTE>'
pwsh -NoProfile -File scripts/backup/restore-test-database.ps1 `
  -BackupDirectory 'E:\backups-criptografados\estoque-fran\postgres-...' `
  -TargetProjectRef '<TEST_PROJECT_REF>' `
  -ProductionProjectRef '<PRODUCTION_PROJECT_REF>' `
  -Confirmation 'RESTORE TEST DATABASE <TEST_PROJECT_REF>'
Remove-Item Env:TEST_RESTORE_DATABASE_URL
```

O script executa `psql --single-transaction` e `ON_ERROR_STOP=1`; uma falha desfaz a transação. Ele
revoga privilégios default amplos antes do schema, restaura roles/schema/dados/histórico e executa
validação somente-leitura. Não usa `--clean`, `DROP`, `db reset` ou destino produtivo.

Mudanças customizadas nos schemas gerenciados `auth` e `storage` exigem revisão separada. Neste
projeto, políticas e buckets são declarados condicionalmente nas migrations. Comparar o resultado
do restore com as migrations e com um `db diff` revisado; nunca aplicar um diff gerado sem revisão.

Supabase Vault ou outra criptografia de coluna exige tratamento da chave raiz. Restore/branching
gerenciado pode copiar a raiz; um restore lógico manual para projeto criado separadamente não deve
ser considerado capaz de descriptografar valores antigos sem o procedimento oficial correspondente.

## 3. Teste de restauração

O teste deve usar projeto isolado e descartável, sem tráfego ou integrações produtivas:

1. validar SHA-256 localmente;
2. restaurar o PostgreSQL em transação única;
3. restaurar objetos do Storage em buckets de teste;
4. validar contagens contra o manifesto operacional do dia do backup;
5. executar `scripts/backup/validate-restored-database.sql`;
6. executar migrations locais em ambiente limpo e comparar histórico;
7. executar `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`;
8. testar login de contas não produtivas, RLS por role e operações transacionais;
9. verificar uma NF, um produto, uma saída, uma perda, uma importação e seus logs;
10. registrar início/fim, RPO observado, RTO observado, erros e decisão de aceite;
11. destruir o ambiente de teste somente após evidências e aprovação.

O teste SQL verifica tabelas críticas, ausência de saldo negativo, coerência entre saldo e último
movimento, RLS, roles, triggers append-only e histórico de migrations. Ele não prova sozinho que o
backup está recuperável: somente o exercício completo prova.

## 4. Frequência recomendada

- dump lógico diário fora do horário de pico;
- backup de Storage diário e também após importação volumosa de NF/documentos;
- dump adicional antes de migrations destrutivas, upgrade de PostgreSQL ou mudança grande;
- teste mensal de restore e teste extraordinário após mudar scripts/CLI/versão PostgreSQL;
- considerar PITR para RPO menor que 24 horas e confirmar a retenção contratada no Dashboard;
- monitorar falha de jobs: ausência de backup novo deve gerar alerta, nunca ser silenciosa.

## 5. Armazenamento externo

Adotar 3-2-1:

- cópia operacional criptografada em storage corporativo;
- segunda cópia em provedor/região/conta diferente do projeto Supabase;
- cópia imutável ou com Object Lock, inacessível às credenciais rotineiras da aplicação.

Separar permissões de criar, ler e apagar backup. A conta que executa backup não deve conseguir
reduzir retenção nem apagar todas as versões. Nunca versionar dumps ou manifestos com dados no Git.

## 6. Criptografia

- TLS em trânsito;
- criptografia forte gerenciada pelo provedor em repouso;
- preferir envelope encryption/KMS com chave fora do mesmo domínio de falha;
- rotação e recuperação de chave testadas;
- acesso temporário, MFA e logs para download/descriptografia;
- nenhuma senha, PAT, `service_role`, connection string ou chave KMS dentro do backup ou repositório.

O SHA-256 garante integridade, não confidencialidade. O diretório gerado deve ser criptografado e
movido imediatamente; arquivos SQL em claro não devem permanecer no executor.

## 7. Retenção

Política inicial sugerida, sujeita à legislação e contrato:

- diários: 35 dias;
- semanais: 12 semanas;
- mensais: 12 meses;
- anuais: conforme obrigação fiscal/jurídica aprovada;
- backups pré-mudança: até dois ciclos de restore bem-sucedidos após estabilização.

Exclusão deve ser automática, auditada e compatível com imutabilidade. Solicitações de exclusão de
dados pessoais precisam considerar backups expirando por retenção, sem reescrita manual de mídias
imutáveis. A política final deve ser aprovada por responsável jurídico/privacidade.

## 8. Recuperação em caso de desastre

1. declarar incidente, severidade, comandante e responsáveis;
2. impedir novas escritas quando necessário sem apagar evidências;
3. identificar último ponto íntegro anterior ao evento e calcular perda esperada;
4. preservar logs, hashes, backup atual e objetos do Storage;
5. escolher PITR físico ou restore lógico para projeto novo;
6. restaurar primeiro em isolamento e executar validações;
7. restaurar Storage separadamente e reconciliar inventário de objetos;
8. reconfigurar Auth, SMTP, URLs, secrets, Edge Functions, Webhooks, Realtime e integrações;
9. trocar credenciais potencialmente comprometidas;
10. realizar aceite técnico e de negócio;
11. promover DNS/tráfego de forma controlada;
12. monitorar erros, saldo, movimentos e filas;
13. produzir relatório pós-incidente e corrigir RPO/RTO/runbook.

Nunca corrigir uma recuperação adulterando `stock_movements`; divergências posteriores usam
movimentos compensatórios pelo motor.

## 9. PostgreSQL versus Supabase Storage

Backup PostgreSQL contém schema e registros, inclusive metadados do Storage quando incluídos no
dump. Ele não contém os bytes dos objetos armazenados pela Storage API. Restaurar o banco para um
ponto antigo não recupera um XML/PDF apagado depois daquele ponto.

Consequentemente, recuperação completa é sempre o par correlacionado:

- backup PostgreSQL;
- backup dos objetos Storage com os mesmos project ref e janela UTC.

## 10. Backup dos arquivos do Storage

Os buckets conhecidos são `import-files`, `invoice-xml` e `invoice-pdf`. Confirmar a lista real no
Dashboard e incluir novos buckets explicitamente. Depois do pré-voo:

```powershell
pwsh -NoProfile -File scripts/backup/backup-storage.ps1 `
  -OutputRoot 'E:\backups-criptografados\estoque-fran' `
  -ProjectRef '<PROJECT_REF>' `
  -Buckets @('import-files', 'invoice-xml', 'invoice-pdf')
```

O helper usa `supabase storage ls --recursive` para inventário e `supabase storage cp --recursive`
para os bytes, produzindo SHA-256 por arquivo. Buckets vazios continuam representados no metadata.
Configuração do bucket, RLS/policies e metadados do objeto pertencem ao banco/migrations; os bytes
pertencem ao backup de Storage.

Para restaurar em teste, criar/revisar os buckets e policies primeiro. Depois copiar um bucket por
vez para o project ref de teste, conferir contagem, tamanho e hashes e só então habilitar tráfego.
Não existe helper de upload automático porque sobrescrever objetos é uma operação destrutiva que
exige decisão específica por conflito.

## 11. Validação do backup

Validação offline:

```powershell
pwsh -NoProfile -File scripts/backup/validate-backup.ps1 `
  -BackupDirectory 'E:\backups-criptografados\estoque-fran\postgres-...'
```

Critérios mínimos:

- status `COMPLETE`;
- todos os arquivos obrigatórios presentes e não vazios;
- tamanho e SHA-256 iguais ao manifesto;
- metadata com project ref, UTC, CLI e commit;
- artefato criptografado e replicado externamente;
- job dentro do RPO;
- teste de restore dentro da periodicidade.

Um hash correto só prova que o arquivo não mudou desde o manifesto. SQL sintaticamente válido só
prova parse. O critério definitivo é restore isolado seguido de validação funcional.

## 12. Restore em teste antes de produção

É proibido saltar diretamente de backup para produção. O candidato deve ser restaurado em um novo
projeto de teste com integrações externas desativadas. Registrar:

- IDs e regiões de origem/destino;
- versões da CLI, `psql`, PostgreSQL origem/destino;
- hashes do banco e Storage;
- início/fim e RTO;
- quantidade de produtos, movimentos, notas, importações, usuários e objetos;
- resultado de RLS, Auth, motor transacional, idempotência e auditoria;
- diferenças de migrations e configuração;
- aprovação nominal para eventual recuperação produtiva.

Somente depois desse aceite uma restauração de produção pode ser planejada. Preferir restore
gerenciado/novo projeto, janela anunciada, congelamento de escrita, novo backup imediatamente antes
da intervenção e dupla confirmação humana. O comando destrutivo permanece manual e fora dos scripts
do repositório.

## Configurações fora do dump

Manter inventário seguro, sem valores secretos, de configurações que não são recuperadas apenas
pelos SQLs: Auth providers, SMTP, URLs de redirect, secrets de Edge Functions, domínios, Webhooks,
Realtime/publications, extensões, rede, SSL, cron externo, alertas e políticas de backup. Os valores
sensíveis devem vir do secret manager durante o desastre.
