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
O Bloco 7 implementa os módulos headless de produtos, categorias e locais com serviços de domínio,
ports, adaptadores Supabase e pesquisa paginada no PostgreSQL.
O Bloco 8 adiciona fornecedores e o recebimento headless de NF-e XML, mantendo leitura/revisão em
staging e fazendo nota, itens e entradas de estoque nascerem juntos somente na confirmação.
O Bloco 9 mantém XML como fonte preferencial e acrescenta PDF como importação assistida: extração
conservadora, evidências, sugestões e revisão humana obrigatória antes da confirmação.
O Bloco 10 adiciona saídas headless para locais de consumo, individuais ou com até 100 itens em uma
única transação, sempre por `consume_stock` e sem mutação direta do saldo.
O Bloco 11 acrescenta perdas documentadas e inventários físicos em staging operacional. Contagem e
revisão apenas fotografam dados; a confirmação administrativa reconcilia diferenças exclusivamente
por movimentos compensatórios do motor.
O Bloco 12 completa a auditoria transacional de cadastros, estoque, notas, importações, migrações e
exportações administrativas, com consulta paginada e bloqueio preventivo de credenciais nos payloads.
O Bloco 13 adiciona o domínio headless de relatórios. Filtros, agregações, ordenação e paginação são
executados no PostgreSQL; o cliente recebe somente a página solicitada e decimais exatos em texto.
O Bloco 14 implementa exportações operacionais versionadas em CSV, XLSX e JSON. Consultas são
administrativas, paginadas e sanitizadas no banco; formatadores puros geram arquivos portáveis sem
confundir exportação de negócio com backup do PostgreSQL.
O Bloco 15 acrescenta importações operacionais futuras e reconciliação explícita por movimentos.
O Bloco 16 define recuperação de desastre como responsabilidade de infraestrutura, com backup lógico
do PostgreSQL, cópia separada do Storage, manifests SHA-256 e restore exclusivamente em teste nos
scripts do repositório.
O Bloco 17 estabelece o shell React responsivo, navegação e guards. O Bloco 18 conecta a primeira
interface operacional ao domínio de migração por um assistente administrativo de dez etapas, sem
transferir validação crítica ou promoção de dados para o React.
O Bloco 19 substitui as estruturas vazias pelas telas operacionais de estoque, cadastros, notas,
saídas, perdas, inventários, relatórios e auditoria. Consultas permanecem paginadas no banco e
confirmações de estoque usam somente os serviços/RPCs transacionais já definidos.

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
`consume_stock_batch`, `register_loss`, `adjust_stock`, `transfer_stock` e
`apply_migration_opening_balance`. Operações simples delegam a uma função privada única, responsável
por autorização, locks, idempotência, movimento, saldo e auditoria na mesma transação. O lote ordena
os locks dos produtos e chama `consume_stock` para cada item, preservando all-or-nothing. Nenhuma
regra crítica depende de React.

`confirm_product_import` é o único limite de promoção do staging de produtos. A função serializa
confirmações, revalida o preview, cria ou associa entidades, chama o núcleo do motor para quantidades
e conclui lote, linhas e auditoria na mesma transação. O adaptador Supabase público não usa
credenciais administrativas; a autorização efetiva permanece no banco.

Os módulos `products`, `categories` e `locations` seguem a mesma direção de dependências:
`application → ports ← infrastructure`. Serviços normalizam e validam entradas; repositórios
Supabase traduzem nomes do domínio para o banco e continuam sujeitos à RLS. Os serviços não expõem
exclusão física. O tipo `Product` não contém saldo, e nenhum input ou record de produto possui campo
de quantidade de estoque.

`PageRequest` é compartilhado pelos três contextos porque existe uso concreto comum. A página padrão
possui 25 itens e o limite rígido é 100. As RPCs de pesquisa devolvem somente a página solicitada e o
total, sem carregar a coleção inteira no navegador.

O módulo `invoices` separa parsers, casos de uso, ports e adaptadores Supabase. O parser XML recusa
DOCTYPE, entidades, stylesheet, encoding inválido, arquivo acima do limite e números que exigiriam
arredondamento. `stage_nfe_xml` persiste somente `invoice_imports`/`invoice_import_items` e resolve
produto por `supplier_product_mappings` ou EAN inequívoco e compatível com a unidade. Descrição nunca
produz associação automática. `review_nfe_import` registra decisões explícitas; somente
`confirm_nfe_import` cria a nota oficial e chama `receive_stock` para cada item na mesma transação.

O parser PDF depende de `PdfTextExtractor`, não do estoque. A implementação PDF.js desabilita
avaliação dinâmica, limita bytes, páginas e texto, preserva página/evidência e aceita ausência de
camada textual sem inventar conteúdo. A normalização só reconhece rótulos e linhas inequívocas;
qualquer lacuna gera issue. `stage_pdf_invoice` nunca resolve automaticamente fornecedor ou produto:
correspondências seguras ficam apenas como sugestões. `review_pdf_invoice` permite completar ou
ignorar linhas explicitamente e `confirm_pdf_invoice` exige revisão humana completa.

O módulo `suppliers` segue o mesmo desenho dos demais dados mestres, incluindo paginação no servidor,
normalização de CNPJ e ciclo de inativação/reativação. Exclusão física não integra o contrato.

O módulo `inventory` expõe `StockOutputService` por `application → ports ← infrastructure`. O serviço
usa strings decimais exatas, exige origem e destino distintos e transforma a saída individual em um
lote de um item. O adaptador chama somente `consume_stock_batch`; a confirmação e todas as regras
críticas permanecem no PostgreSQL.

O mesmo módulo expõe `InventoryCountService`. Suas RPCs controlam
`DRAFT → COUNTING → REVIEW → CONFIRMED`; produtos são bloqueados em ordem estável ao fotografar e ao
confirmar. O saldo fotografado em `REVIEW` precisa continuar atual na confirmação. Cada diferença
chama `adjust_stock`, enquanto diferença zero não cria movimento. Esse desenho é a referência para
reconciliações futuras de quantidades externas, que também nunca poderão sobrescrever saldo.
`StockAdjustmentService` oferece ajustes administrativos explícitos, mas seu adaptador chama somente
`adjust_stock`; nem o serviço nem o repositório expõem `UPDATE` de saldo.

O módulo `losses` encapsula `register_stock_loss`. A RPC cria o movimento por `register_loss` e o
registro documental com motivo e observação na mesma transação. Nenhum port desses módulos oferece
escrita direta em `stock_balances` ou `stock_movements`.

O módulo `audit` separa o histórico operacional de estoque da trilha de responsabilidade. Triggers
`AFTER` capturam snapshots permitidos dos dados mestres, notas e lotes na mesma transação da mudança.
Eventos do motor são classificados conforme movimento, sem copiar credenciais. `AuditService` chama
uma RPC `SECURITY INVOKER` paginada; RLS mantém a consulta exclusiva de `ADMIN`. Exportações apenas
registram tipo, formato, contagem e idempotência depois da conclusão, nunca o conteúdo exportado.

O módulo `reports` segue `application → ports ← infrastructure` e não oferece comandos. Seis RPCs
produzem estoque atual, consumo agregado, perdas, entradas confirmadas, movimentações e saldos
iniciais de migração. Todas aplicam filtros e limite máximo de 100 linhas antes de serializar a
resposta. A leitura de migração usa uma fronteira `SECURITY DEFINER` estreita para não conceder ao
`VIEWER` acesso geral ao staging nem expor hash, arquivo ou metadados do lote.

O módulo `data-export` também segue `application → ports ← infrastructure`. O serviço normaliza
filtros e seleções, percorre páginas de até 500 linhas, valida cada resposta contra um schema fechado,
gera o arquivo em memória e só então registra a conclusão em auditoria. CSV, XLSX e JSON compartilham
`export_schema_version = 1`; nenhum formatador recebe tabelas ou campos arbitrários. O XLSX é OpenXML
sem fórmulas, macros, objetos ou links externos, e possui planilhas de dados e metadados.

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

## Importação operacional

O domínio operacional de `data-import` mantém `application → ports ← infrastructure`.
`previewOperationalImport` usa os parsers tabulares existentes, valida um
`OperationalColumnMapping` específico por tipo e entrega somente linhas normalizadas ao staging.
`OperationalImportService` controla preview paginado, resolução e confirmação; o adaptador Supabase
não conhece nem oferece mutação direta de saldo. Templates oficiais são gerados em CSV/XLSX e
continuam independentes das telas.

`STOCK_RECONCILIATION` é uma fronteira própria, não uma opção oculta da importação de produtos. A
regra crítica reside na RPC: ela bloqueia produtos, verifica que o saldo não mudou desde o preview e
chama o motor transacional para gerar ajustes. O React futuro apenas apresentará o preview e
solicitará a confirmação administrativa.

## Backup e restore

Backup/restore não é um módulo React nem uma RPC da Data API. Os helpers em `scripts/backup` são
operações de infraestrutura: recusam gravar dumps dentro do repositório, não aceitam secrets por
argumento, produzem hashes e separam PostgreSQL dos objetos Storage. O restore automatizado aceita
somente um project ref de teste diferente da produção, exige confirmação literal e usa uma única
transação com interrupção no primeiro erro.

Migrations versionadas e o histórico `supabase_migrations` acompanham o dump, mas permanecem fontes
distintas que precisam ser comparadas. Restore produtivo físico/PITR ou lógico continua manual,
aprovado e precedido por exercício isolado.

## Interface web

A interface React usa React Router em modo declarativo. `AuthProvider` observa a sessão pública do
Supabase e carrega roles exclusivamente de `roles`/`user_roles`; `RequireSession` e
`RequirePermission` controlam navegação e experiência, sem substituir RLS ou autorização das RPCs.
A configuração de rotas é única e alimenta simultaneamente router, sidebar e atalhos, evitando que a
navegação visível divirja das permissões declaradas.

O shell é desktop-first, com sidebar fixa e header, tornando-se off-canvas em tablets e celulares.
Componentes reutilizáveis cobrem formulário, tabela, dialog, notificações e estados de loading, erro
e vazio. As páginas de domínio deste bloco são apenas estruturas: não consultam coleções inteiras,
não simulam dados operacionais e não oferecem qualquer escrita direta de saldo.

A página de importação é a primeira exceção funcional às estruturas vazias. Parsing e normalização
local fornecem feedback antes do envio; o staging, a reclassificação e a confirmação continuam em
RPCs administrativas. O adaptador `SupabaseProductImportWizardRepository` expõe apenas staging,
preview paginado e resolução. A promoção usa o port de confirmação já existente e o motor de
estoque. Assim, voltar etapas ou manipular o estado React nunca concede capacidade de gravar produto
ou saldo sem que o PostgreSQL repita autorização e invariantes.

As telas operacionais compartilham paginação, estados assíncronos, filtros, seletores de entidades e
formulários, mas não compartilham regras críticas. Estoque atual usa `report_current_stock`, inclusive
para tipo, categoria e situação. Produtos, categorias, locais e fornecedores usam seus serviços de
domínio e preservam inativação em vez de exclusão. Ações de cadastro aparecem somente para roles com
`MANAGE_SYSTEM`, enquanto RLS continua sendo a autorização efetiva.

Saídas em lote chamam `consume_stock_batch`; perdas chamam `register_stock_loss`; inventários seguem
as RPCs de transição de estado; entradas fiscais só confirmam lotes revisados pelo backend. Os novos
saldos mostrados depois de saídas e perdas são os campos `newBalance` devolvidos pelas confirmações,
nunca cálculos locais. Relatórios e logs usam filtros e páginas enviados às RPCs correspondentes.
Cada tela de domínio é carregada sob demanda para manter parsers XML/PDF e módulos administrativos
fora do bundle inicial.
