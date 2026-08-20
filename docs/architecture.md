# Arquitetura

## Visão atual

O projeto é um monólito modular no frontend, com React e TypeScript, apoiado por Supabase e
PostgreSQL. O Bloco 0 estabeleceu limites, ferramentas e contratos de segurança. Os Blocos 2 e 3
adicionam o primeiro domínio desacoplado de React: análise segura, staging, mapeamento configurável,
validação e identificação conservadora de dados de migração. O Bloco 4 adiciona autenticação
headless com Supabase Auth e autorização efetiva no PostgreSQL por roles e RLS. O Bloco 5 adiciona
o motor de estoque como funções PostgreSQL transacionais, sem interface e sem escrita direta do
frontend nas tabelas de saldo ou histórico. O Bloco 6 conecta o staging ao cadastro oficial por uma
confirmação administrativa, atômica e idempotente de produtos.

## Organização

- `src/modules`: contextos funcionais independentes.
- `src/lib`: integração técnica com bibliotecas externas, inicialmente Supabase.
- `src/services`: orquestração compartilhada que não pertence a um único módulo.
- `src/types`: tipos realmente compartilhados.
- `src/utils`: utilitários puros e genéricos.
- `src/config`: leitura e validação de configuração.
- `supabase/migrations`: evolução versionada do PostgreSQL.
- `supabase/functions`: funções executadas em ambiente seguro quando necessárias.
- `tests`: testes unitários, de integração e fixtures sem dados sensíveis.

## Direção das dependências

Componentes de interface podem chamar casos de uso do próprio módulo. Casos de uso podem depender
de contratos de serviço. Integrações externas implementam esses contratos. Regras críticas de
estoque, autorização e atomicidade devem residir no PostgreSQL ou em backend confiável, nunca apenas
em componentes React.

Módulos não devem acessar internamente outros módulos por caminhos profundos. Quando uma integração
for necessária, cada módulo deverá expor uma API pública pequena. Abstrações compartilhadas serão
criadas somente após existir uso concreto.

O módulo `data-import` separa `domain`, `application`, `parsers`, `ports`, `infrastructure` e
`config`. Parsers não conhecem nomes de colunas legadas. Casos de uso dependem de ports e não
possuem acesso direto de escrita a produtos ou saldos. Consultas de categorias e identidades de
produto passam por ports somente-leitura. A confirmação usa um port dedicado cuja implementação
chama exclusivamente a RPC transacional do PostgreSQL.

O módulo `auth` encapsula login, logout, leitura do usuário autenticado, roles e permissões para a
futura interface. Essas permissões melhoram a experiência, mas não substituem RLS. O banco consulta
somente `profiles`, `roles` e `user_roles`; uma sessão `authenticated` sem role não recebe acesso aos
dados operacionais.

O limite de escrita do domínio de estoque é formado pelas RPCs `receive_stock`, `consume_stock`,
`register_loss`, `adjust_stock`, `transfer_stock` e `apply_migration_opening_balance`. Elas delegam a
uma função privada única, responsável por autorização, locks, idempotência, movimento, saldo e
auditoria na mesma transação. Nenhuma regra crítica depende de React.

`confirm_product_import` é o único limite de promoção do staging de produtos. A função serializa
confirmações, revalida o preview, cria ou associa entidades, chama o núcleo do motor para quantidades
e conclui lote, linhas e auditoria na mesma transação. O adaptador Supabase público não usa
credenciais administrativas; a autorização efetiva permanece no banco.

## Cliente Supabase

`getSupabaseClient` cria sob demanda uma instância única para o navegador. A inicialização tardia
permite executar verificações e gerar o bundle sem inventar credenciais. A aplicação falha de forma
explícita quando tentar usar Supabase sem as duas variáveis públicas obrigatórias.

Supabase Auth mantém a sessão pública do usuário. Não existe cliente administrativo no frontend e
nenhum fluxo usa `service_role`. A criação em `auth.users` gera somente o perfil correspondente;
roles são concedidas depois por um administrador e nunca derivadas de metadados do JWT.

## Qualidade

TypeScript usa modo estrito e verificações adicionais. ESLint aplica regras tipadas, Prettier
padroniza a formatação e Vitest executa testes. O gate mínimo de conclusão é lint, typecheck, testes
e build sem falhas.
