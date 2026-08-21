# Auditoria de segurança — Bloco 23

Data da auditoria: 21 de agosto de 2026
Escopo: aplicação React/TypeScript, migrations PostgreSQL/Supabase, Auth, RLS, RPCs, Storage,
importações, exportações, auditoria, dependências e configuração local do frontend.

## Resultado executivo

Não foi encontrado problema **CRITICAL**. Foram encontrados dois problemas **HIGH**, ambos
corrigidos e cobertos por testes de regressão:

1. as tabelas de staging ainda aceitavam escrita direta de `authenticated` quando a linha passava
   pela policy administrativa;
2. a proteção de CSV podia ser contornada por whitespace Unicode, quebra de linha ou BOM antes do
   caractere de fórmula.

O estado final local não possui achado CRITICAL ou HIGH aberto. Permanecem dois riscos MEDIUM e dois
LOW que dependem de configuração operacional, definição de hosting ou melhoria futura da fronteira
de upload. Eles não permitem escrita direta de saldo nem bypass de role no estado auditado.

## Metodologia e evidências

- leitura de todas as migrations e adaptadores Supabase;
- inspeção do catálogo PostgreSQL após aplicar, em ordem, todas as migrations em banco PGlite
  isolado;
- testes como `anon`, `authenticated` sem role, `VIEWER`, `STOCK_OPERATOR`, `ADMIN`, usuário inativo
  e dois operadores distintos;
- execução do Supabase Database Security Advisor no projeto vinculado;
- `supabase db lint --linked --level warning --fail-on none`;
- busca no working tree e histórico Git por `service_role`, secret keys, JWTs administrativos,
  connection strings e chaves privadas;
- `npm audit`, `npm audit --omit=dev`, `npm audit signatures` e `npm ls --all`;
- inspeção do lockfile quanto a integridade, dependências fora do registry e install scripts;
- testes hostis de CSV/XLSX, XML e PDF, incluindo fórmulas, conteúdo ativo, XXE/DOCTYPE, ZIP path
  traversal, ZIP bomb, encoding, arquivos truncados, limites e duplicidade;
- revisão de SQL estático/dinâmico, filtros, RPCs, `SECURITY DEFINER`, views e políticas de Storage.

Referências de controle: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control),
[Storage Ownership](https://supabase.com/docs/guides/storage/security/ownership) e
[npm security](https://supabase.com/docs/guides/security/npm-security).

## Achados

| ID        | Severidade | Estado                     | Achado e tratamento                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-23-01 | HIGH       | CORRIGIDO                  | `authenticated` possuía `INSERT/UPDATE` por coluna em `import_batches`, `import_rows` e `external_entity_mappings`. Isso permitia a um ADMIN alterar staging fora das RPCs e enfraquecia a garantia de validação/preview. A migration `20260821214651_harden_import_staging_access.sql` revoga toda escrita da Data API e remove as policies de mutação. Leitura administrativa permanece; gravação passa somente pelas RPCs validadas.           |
| SEC-23-02 | HIGH       | CORRIGIDO                  | CSV Injection podia usar quebra de linha, NBSP ou BOM antes de `=`, `+`, `-` ou `@`. O formatador agora reconhece whitespace Unicode/BOM antes do operador e prefixa apóstrofo. XLSX continua usando exclusivamente `inlineStr`, sem elemento `<f>`.                                                                                                                                                                                              |
| SEC-23-03 | MEDIUM     | ABERTO — CONFIGURAÇÃO      | O Security Advisor remoto informou **Leaked Password Protection Disabled**. Habilitar a proteção de senhas vazadas no painel do Supabase Auth antes da entrada em produção. Não é uma alteração de migration nem deve ser simulada no frontend.                                                                                                                                                                                                   |
| SEC-23-04 | MEDIUM     | MITIGADO / MELHORIA FUTURA | CSV/XLSX/XML/PDF são analisados no navegador e as RPCs revalidam autorização, tipos, limites de negócio e conflitos, mas o PostgreSQL não atesta criptograficamente que o payload normalizado corresponde ao objeto do Storage. Para operadores internos autorizados o impacto é limitado e cada operação fica atribuída ao usuário; para cenário futuro com usuários não confiáveis, mover leitura/hash para backend confiável ou Edge Function. |
| SEC-23-05 | LOW        | ABERTO — HOSTING           | O repositório não define headers HTTP de produção porque o provedor de hosting ainda não foi escolhido. Configurar CSP, `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` e HSTS no ambiente publicado.                                                                                                                                                                                                                              |
| SEC-23-06 | LOW        | ABERTO                     | O linter remoto apontou apenas warnings de tipagem/variáveis PL/pgSQL: variáveis de loop sombreadas, casts de retorno implícitos e uma função marcada `IMMUTABLE` contendo `RAISE`. Não houve SQL injection, privilégio indevido ou erro de RLS associado. Corrigir em manutenção específica, com nova rodada de testes.                                                                                                                          |

## RLS, Auth e autorização

- Todas as 23 tabelas públicas estão com RLS e ao menos uma policy.
- `anon` não possui `EXECUTE` em função da aplicação nem acesso operacional.
- `authenticated` isoladamente não autoriza; perfil ativo e role em `user_roles` são obrigatórios.
- `user_metadata` não é consultado para autorização e existe teste usando `user_metadata.role = ADMIN`
  sem conceder acesso.
- `anon` e `authenticated` não possuem `BYPASSRLS`.
- O frontend usa `getUser()` para validar a identidade atual antes de carregar roles do banco.
- Guards e botões da interface são somente defesa de experiência; RLS/RPC repetem a decisão no
  banco.
- `VIEWER` não acessa staging, logs administrativos nem operações de estoque.
- Dois operadores distintos foram testados: o segundo não consulta, revisa ou confirma a
  importação fiscal criada pelo primeiro. `ADMIN` conserva a supervisão prevista.
- Nenhuma role da Data API altera diretamente `stock_balances`, `stock_movements`, `audit_logs`,
  `import_batches`, `import_rows` ou `external_entity_mappings`.

## RPCs, SQL injection, IDOR/BOLA e views

- As RPCs usam parâmetros tipados e SQL estático; não foi encontrado `EXECUTE`, `format()` ou
  concatenação de identificadores baseada em entrada externa.
- Funções públicas `SECURITY DEFINER` são endpoints intencionais. Todas fixam
  `search_path = pg_catalog`, usam nomes qualificados e revalidam role/perfil ou delegam para helper
  privado que faz essa validação.
- O Security Advisor remoto, após o deploy das migrations, listou 37 warnings genéricos de funções `SECURITY DEFINER` executáveis
  por `authenticated`. Eles foram revisados individualmente como fronteiras RPC intencionais; o
  grant não basta para executar a regra protegida.
- Helpers privados executáveis por `authenticated` estão reduzidos a `is_active_user`, `has_role`
  e `has_any_role`, necessários às policies. Os demais não têm `EXECUTE` externo.
- Não há view ou materialized view em `public`; portanto não existe view `security definer`
  contornando RLS.
- IDs recebidos do cliente são UUIDs tipados e as operações com escopo de usuário verificam
  `created_by = auth.uid()` no banco. Itens revisados também precisam pertencer ao cabeçalho
  informado.

## Importação e arquivos hostis

### CSV/XLSX

- limite padrão de 10 MiB, 10.000 linhas, 200 colunas e 10.000 caracteres por célula;
- encoding fatal, rejeição de NUL, CSV malformado e quantidade de colunas inconsistente;
- cabeçalhos vazios ou duplicados são rejeitados após NFKC/casefold;
- texto semelhante a fórmula é rejeitado mesmo após whitespace Unicode;
- XLSX é inspecionado antes da descompactação: ZIP64/multipart, criptografia, caminho absoluto,
  `..`, entradas duplicadas, método desconhecido, VBA, ActiveX, embeddings, external links e
  connections são rejeitados;
- limites de 5.000 entradas, 50 MiB expandidos, 25 MiB por entrada e razão de compactação 200
  reduzem risco de ZIP bomb;
- células `<f>`, strings de fórmula e XML com DOCTYPE/ENTITY são rejeitados;
- hash SHA-256, batch original e aprovação explícita de duplicidade impedem repetição acidental;
- o banco recalcula classificação/conflitos a partir da linha normalizada e a confirmação repete
  validações críticas. Escrita direta no staging foi removida.

### NF-e XML

- limite de 10 MiB, 5.000 itens e 2.000 caracteres por texto relevante;
- bytes, extensão, tamanho lido, encoding, XML bem-formado, `DOCTYPE`, `ENTITY` e
  `xml-stylesheet` são validados;
- chave de acesso, CNPJ, EAN, datas, decimais, itens repetidos e identidade fiscal são validados;
- conteúdo nunca associa produto somente por descrição e nunca movimenta estoque antes da
  confirmação;
- o bucket é privado, MIME/size-limited e operador acessa somente o prefixo do próprio UUID.

### PDF

- limite de 15 MiB, 100 páginas, 2.000.000 de caracteres extraídos e 5.000 itens;
- assinatura PDF, tamanho lido, PDF com senha, falhas de parsing e extração parcial são tratados;
- PDF.js usa `isEvalSupported: false`, sem fonte dinâmica, e interrompe em erros;
- toda extração fica `PENDING_REVIEW`; associação e confirmação exigem revisão humana completa;
- bucket privado e isolado por role/prefixo, com `application/pdf` allowlisted.

## Exportação, logs e secrets

- CSV UTF-8 possui BOM e neutraliza `=`, `+`, `-` e `@`, inclusive após whitespace Unicode, tabs,
  CR/LF e BOM.
- XLSX usa `inlineStr`; não cria fórmulas, macros ou relacionamentos externos.
- Projeções SQL possuem allowlist, paginação e filtros tipados; não exportam Auth, staging bruto,
  caminhos internos ou credenciais.
- O validador do adaptador recusa campos sensíveis mesmo se houver regressão na projeção SQL.
- `audit_logs` recusa recursivamente nomes/valores de senha, token, JWT, cookie, chave privada,
  `service_role` e connection string. Usuários comuns não alteram logs.
- Nenhum secret real foi encontrado no working tree ou histórico Git. `.env.local` não é rastreado.
- O frontend aceita somente URL e publishable key. A configuração agora falha imediatamente se a
  variável pública receber `sb_secret_`, texto `service_role` ou JWT legado com role
  `service_role`.

## Dependências

- dependências diretas usam versões exatas e `package-lock.json` está versionado;
- `npm audit` e `npm audit --omit=dev`: zero vulnerabilidades conhecidas;
- 219 pacotes tiveram assinatura de registry verificada e 102 tiveram attestation verificada;
- 261 entradas instaladas possuem integridade e nenhuma origem fora de `registry.npmjs.org`;
- existe um único install script no lockfile, do pacote opcional/plataforma `fsevents`; ele não é
  usado no Windows atual;
- `npm ls --all` mostrou somente dependências opcionais ausentes esperadas para outras plataformas
  ou recursos opcionais.

## Checklist antes de produção

1. Confirmar em cada deploy que o histórico remoto contém todas as migrations versionadas.
2. Reexecutar o Security Advisor após o deploy e confirmar que surgem somente endpoints
   `SECURITY DEFINER` intencionais.
3. Habilitar Leaked Password Protection no Supabase Auth.
4. Definir headers de segurança no hosting e testar CSP sem liberar `unsafe-eval`.
5. Repetir `npm audit`, testes de permissão e catálogo em cada alteração de migrations/RPCs.
6. Para ampliar o sistema a usuários externos, mover parsing/atestado de hash para backend
   confiável antes de aceitar esse novo modelo de ameaça.
