# Segurança

## Segredos

Somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são aceitos no frontend. Qualquer
variável `VITE_` pode ser lida por quem baixar o bundle. Portanto `service_role`, senhas do banco,
JWT secrets e connection strings administrativas são proibidos no frontend, no Git e em fixtures.

Segredos de backend devem ser mantidos no gerenciador de secrets do ambiente de execução. O arquivo
`.env.example` contém apenas nomes e exemplos não funcionais; arquivos `.env*` reais são ignorados.

## Autorização

- RLS é obrigatória em toda tabela exposta.
- Grants e exposição pela Data API são explícitos e mínimos.
- Políticas são testadas com identidades permitidas e negadas.
- `user_metadata` não concede privilégios.
- O JWT identifica o usuário com `auth.uid()`; autorização vem de perfil ativo, `roles` e
  `user_roles` no banco.
- `authenticated` sem role não acessa dados operacionais.
- Funções privilegiadas validam identidade, papel, entrada e escopo no servidor.
- Funções `SECURITY DEFINER`, quando inevitáveis, fixam `search_path` e concedem execução mínima.

### Roles

- `ADMIN`: gerencia perfis, associações de role, cadastros, notas, staging e arquivos de importação;
  consulta auditoria.
- `STOCK_OPERATOR`: consulta o estoque, prepara notas próprias e executa entrada, consumo, perda e
  transferência exclusivamente pelas funções do motor transacional.
- `VIEWER`: consulta cadastros, notas, saldos, movimentos e relatórios.

Nenhuma role da aplicação recebe mutação direta de `stock_balances` ou `stock_movements`. Nem mesmo
`ADMIN` substitui o motor transacional. Ajustes e abertura de saldo legado são administrativos.

Novos usuários recebem perfil, mas nenhuma role automática. O bootstrap do primeiro `ADMIN` deve
ser feito uma única vez pelo SQL Editor ou outro ambiente administrativo confiável, nunca pelo
frontend. O último administrador ativo não pode ser removido nem desativado.

Depois de criar o primeiro usuário no Supabase Auth, o bootstrap usa o UUID real desse usuário nos
dois parâmetros abaixo:

```sql
insert into public.user_roles (profile_id, role_id, granted_by)
select 'UUID_DO_USUARIO'::uuid, id, 'UUID_DO_USUARIO'::uuid
from public.roles
where code = 'ADMIN';
```

Esse procedimento não utiliza `service_role` no navegador e não deve ser transformado em endpoint
público.

### Storage

O bucket `import-files` é privado, limitado a 10 MiB e aceita apenas MIME types configurados para
CSV/XLSX. Todas as operações de objetos exigem `ADMIN` via RLS. Caminhos e nomes de objetos não
concedem autorização por si mesmos.

O bucket `invoice-xml` também é privado e limitado a 10 MiB. `STOCK_OPERATOR` insere e lê apenas na
pasta iniciada por seu próprio UUID; `ADMIN` pode ler todos e é a única role que remove. Policies
validam role e autoria do caminho conjuntamente. MIME type e extensão ajudam na triagem, mas o parser
continua validando os bytes e a estrutura antes do staging.

O bucket `invoice-pdf` é privado, limitado a 15 MiB e aceita apenas `application/pdf`. Usa o mesmo
isolamento por pasta do usuário. PDF.js lê bytes com avaliação dinâmica desabilitada; a aplicação
limita páginas e texto extraído e nunca confia somente na extensão ou no MIME type.

## Operações críticas

Validação no cliente melhora a experiência, mas não constitui controle de segurança. Atomicidade,
idempotência, limites de quantidade, não negatividade e imutabilidade do histórico devem ser
impostos pelo banco ou backend confiável. Logs não devem conter tokens, credenciais ou conteúdo
sensível desnecessário.

As funções públicas de estoque concedem `EXECUTE` somente a `authenticated` e revalidam perfil
ativo e role internamente; receber o grant não basta para executar a operação. Helpers internos não
concedem execução a `public`, `anon` ou `authenticated`. Todas as funções privilegiadas usam
`SECURITY DEFINER` com `search_path` fixo e referências qualificadas.

Locks transacionais por chave de idempotência e produto serializam requisições concorrentes. A linha
de saldo também é bloqueada com `FOR UPDATE`. A chave fica associada ao autor e ao payload exato,
evitando tanto efeito duplicado quanto reutilização entre usuários. O registro de auditoria integra
a mesma transação do movimento e do saldo.

`consume_stock_batch` limita o lote a 100 itens, exige local `STOCK` de origem e `CONSUMPTION` de
destino e bloqueia os produtos em ordem determinística antes de chamar `consume_stock`. As tabelas de
cabeçalho e itens não concedem mutação direta, possuem RLS e triggers append-only. A chave do lote é
única e o replay compara autor, locais, motivo e payload canônico completo.

`register_stock_loss` exige `ADMIN` ou `STOCK_OPERATOR`, vincula o documento ao movimento `LOSS` e
não oferece caminho alternativo de saldo. `stock_losses` concede somente leitura por RLS e permanece
append-only inclusive para administradores.

As RPCs de preparação do inventário exigem `ADMIN` ou `STOCK_OPERATOR`; somente `ADMIN` confirma e,
portanto, alcança `adjust_stock`. Produtos são bloqueados em ordem determinística e o saldo atual é
comparado ao snapshot de `REVIEW` antes do primeiro ajuste. `inventory_counts` e itens não concedem
mutação direta, usam RLS e bloqueiam qualquer alteração depois de `CONFIRMED`.

`confirm_product_import` também concede `EXECUTE` somente a `authenticated`, mas exige `ADMIN` ativo
internamente. A função fixa `search_path`, revalida integralmente o staging e é o único caminho do
módulo de importação para cadastros, mapeamentos e estoque. Novas colunas de resultado da promoção
não recebem grants diretos de atualização para a Data API.

`search_products`, `search_categories` e `search_locations` são `SECURITY INVOKER`: executam com os
privilégios do chamador e preservam a RLS das tabelas. `anon` não recebe `EXECUTE`; usuários
autenticados sem role recebem coleção vazia pela RLS. Cada função valida página e limita o tamanho a 100. Nenhuma função de pesquisa retorna `stock_balances`.

Mutações dos três cadastros continuam usando os grants por coluna e policies administrativas já
existentes. Os adaptadores enviam `created_by`/`updated_by` obtidos da sessão, e o banco exige que
correspondam a `auth.uid()`. Não há grant de `DELETE`; triggers também bloqueiam exclusão física em
ambientes administrativos.

Policies restringem linhas e grants por coluna preservam autoria e datas de criação. Histórico e
auditoria não possuem mutações concedidas à Data API; `stock_movements` e `audit_logs` mantêm também
triggers contra edição e exclusão.

Auditoria automática usa funções `SECURITY DEFINER` somente para inserir snapshots explicitamente
permitidos na mesma transação da entidade. Uma validação recursiva no banco bloqueia nomes de campos
sensíveis e padrões de `service_role`, tokens JWT/Bearer e connection strings. As constraints também
protegem inserções feitas fora dos triggers. A consulta `search_audit_logs` é `SECURITY INVOKER`,
portanto somente `ADMIN` atravessa a RLS; páginas são limitadas a 100.

`record_administrative_export` exige `ADMIN`, é idempotente e aceita apenas tipo allowlisted, formato,
contagem e chave de correlação. A função não aceita conteúdo, filtros livres, caminhos com
credenciais ou qualquer secret.

`export_operational_data_page` exige `ADMIN` ativo e valida tipo, página, seleção e uma allowlist de
filtros específica para cada conjunto. Não usa SQL dinâmico. As projeções SQL nomeiam cada coluna,
incluem identificadores humanos e omitem deliberadamente credenciais, dados internos de Auth,
staging bruto e caminhos de Storage. O adaptador rejeita campos extras, tipos não escalares e nomes
sensíveis mesmo que uma regressão futura do banco tente retorná-los.

O CSV neutraliza células iniciadas por `=`, `+`, `-` ou `@`; o XLSX grava conteúdo como `inlineStr`
e não cria elementos de fórmula. Limites de linhas, seleção, célula e bytes reduzem risco de consumo
excessivo de memória. Se a quantidade total mudar entre páginas, a operação é abortada e não recebe
evento de conclusão. A auditoria contém apenas tipo, formato, contagem, versão e idempotência, nunca
o conteúdo exportado.

As seis RPCs de relatório concedem `EXECUTE` apenas a `authenticated` e revalidam perfil ativo e
role `ADMIN`, `STOCK_OPERATOR` ou `VIEWER`. Elas usam `SECURITY DEFINER` com `search_path` fixo,
referências qualificadas e SQL estático. Essa fronteira permite compor leituras entre tabelas com
escopos RLS diferentes sem conceder acesso direto adicional. O relatório de migração seleciona uma
lista segura de campos e nunca retorna `raw_data`, arquivo, hash, metadata, tokens ou secrets.
Parâmetros de página, período, enum e UUID são tipados/validados; não existe SQL dinâmico.

`stage_nfe_xml`, `review_nfe_import` e `confirm_nfe_import` concedem `EXECUTE` somente a
`authenticated`, mas exigem `ADMIN` ou `STOCK_OPERATOR` ativo internamente. Operadores só atuam nos
próprios stagings. Nenhuma delas confia em nomes de produto ou em metadados de usuário. A confirmação
usa lock transacional, unicidade fiscal e chaves determinísticas do motor de estoque; não há grant de
mutação direta nas tabelas de staging.

As RPCs de PDF aplicam a mesma autorização. `stage_pdf_invoice` guarda somente extração e sugestões;
`review_pdf_invoice` exige decisões explícitas e autoria; `confirm_pdf_invoice` rejeita staging sem
revisão humana completa. O núcleo de confirmação XML não é exposto depois da especialização por
fonte, impedindo que um PDF seja confirmado pela RPC de XML.

As RPCs de importação operacional concedem `EXECUTE` a `authenticated`, mas exigem perfil ativo com
role `ADMIN` internamente. O banco repete a allowlist de campos por tipo, recusa qualquer quantidade
em importação de cadastro e pagina o preview em até 500 linhas. Conflitos e categorias candidatas
bloqueiam a confirmação até resolução explícita.

Na reconciliação, locks consultivos por produto usam a mesma chave do motor de estoque. Todos os
snapshots são revalidados antes do primeiro ajuste; mudança concorrente lança erro de serialização e
reverte a transação. Somente `private.execute_stock_movement` altera o saldo, com motivo fixo,
`import_batch_id` e idempotência por linha. Nenhuma nova policy ou grant permite `UPDATE` direto em
`stock_balances` ou mutação de `stock_movements`.

## Backups de infraestrutura

Backups lógicos e objetos Storage são dados sensíveis, mesmo sem credenciais explícitas. Devem ser
criptografados, mantidos fora do repositório e acessíveis por identidade administrativa separada da
aplicação. SHA-256 detecta alteração, mas não fornece confidencialidade.

Os scripts não aceitam senha, PAT, `service_role` ou connection string pela linha de comando. A URL
do único restore automatizado fica em variável de ambiente, deve identificar um projeto de teste e
é recusada quando contém o project ref produtivo. Não há tela, endpoint ou script de restore de
produção.

## Dependências

O lockfile deve ser versionado. Atualizações precisam passar pelos quatro gates de qualidade e por
análise de vulnerabilidades compatível com o risco antes da implantação.
