# Regras de negócio invariáveis

## Autorização

- Possuir sessão `authenticated` não concede autorização por si só.
- Autorização usa exclusivamente perfil ativo e associações em `roles`/`user_roles`.
- `user_metadata` nunca concede role ou permissão.
- `ADMIN` gerencia cadastros, acessos e importações.
- `STOCK_OPERATOR` consulta estoque e prepara operações permitidas, sempre por fluxos autorizados.
- `VIEWER` possui somente consulta de estoque e relatórios.
- Nenhum usuário da aplicação altera diretamente `stock_balances` ou `stock_movements`.
- O último administrador ativo não pode ser removido nem desativado.

## Estoque

- O frontend nunca escreve saldo diretamente.
- Toda entrada, saída, transferência, perda, ajuste ou carga inicial passa pelo motor transacional.
- Cada operação é atômica: movimento e efeito no saldo confirmam juntos ou são revertidos juntos.
- Movimentos concluídos são permanentes e imutáveis.
- Correções usam movimentos compensatórios; o histórico original permanece intacto.
- Estoque negativo é proibido por padrão.
- Cada movimento registra autor, instante, origem, motivo e identificadores de correlação.
- Repetir uma solicitação crítica com a mesma chave de idempotência não duplica seu efeito.
- A chave de idempotência pertence ao usuário e ao payload original; não pode ser reaproveitada por
  outra identidade ou operação diferente.
- Entrada, consumo, perda e transferência exigem `ADMIN` ou `STOCK_OPERATOR`.
- Ajustes e saldo inicial de migração exigem `ADMIN`.
- Perdas e ajustes exigem motivo explícito.
- Perda registra também observação opcional, unidade fotografada, local, autor e data; seu registro
  documental e o movimento `LOSS` confirmam juntos.
- No modelo central atual, transferências preservam a quantidade agregada e registram os dois locais.
- Saídas exigem origem ativa `STOCK` e destino ativo `CONSUMPTION`; o destino nunca é implícito.
- Uma saída pode conter de 1 a 100 itens. Todos confirmam juntos ou todos são revertidos.
- Cada item de saída chama `consume_stock`, registra a unidade vigente do produto e fica vinculado ao
  cabeçalho imutável da operação.
- Repetir um lote com a mesma chave e o mesmo payload retorna o resultado anterior; mudar usuário,
  locais, itens, quantidades ou motivo gera conflito.
- Inventários percorrem somente `DRAFT → COUNTING → REVIEW → CONFIRMED`. `REVIEW` pode retornar para
  `COUNTING` quando for necessário recontar.
- Salvar contagens e entrar em revisão nunca altera saldo. A revisão registra saldo do sistema e
  diferença para cada produto.
- Confirmar inventário exige `ADMIN`, saldo ainda igual ao fotografado e transação all-or-nothing.
  Diferença positiva chama `adjust_stock` com delta positivo; diferença negativa usa delta negativo;
  diferença zero não gera movimento.
- Inventário confirmado é imutável e idempotente. Reutilizar a chave com outra confirmação é conflito.
- Cada produto pode possuir no máximo um marco `MIGRATION_OPENING_BALANCE`, sempre vinculado a um
  lote de importação válido e identificado como `Migração sistema legado`.

## Dados mestres

- Produto, categoria e local são removidos de uso por `is_active`; os serviços não oferecem delete.
- Exclusão física de produtos, categorias e locais é bloqueada no PostgreSQL, inclusive para evitar
  perda futura de rastreabilidade.
- Criar ou editar produto nunca recebe nem altera saldo. Saldo pertence exclusivamente ao motor de
  estoque.
- SKU é normalizado e permanece protegido contra duplicidade pelo banco.
- EAN informado deve ser um GTIN-8, 12, 13 ou 14 válido.
- Quantidade mínima usa texto decimal exato e `NUMERIC(18,3)` no banco; números de ponto flutuante não
  fazem parte do contrato do serviço.
- Locais aceitam somente `STOCK` ou `CONSUMPTION`.
- Listagens e pesquisas são paginadas no servidor, com no máximo 100 registros por chamada.
- Fornecedor com histórico é inativado e nunca excluído; documento informado é normalizado para CNPJ.

## Auditoria

- `stock_movements` é o fato permanente que explica o saldo; `audit_logs` é a trilha de ação, autoria,
  entidade e snapshots. Um não substitui o outro.
- Produto, categoria, local e fornecedor geram eventos de criação, alteração, inativação e reativação.
- Nota, ajuste, perda, migração, importação, confirmação de lote e exportação administrativa são
  auditados na mesma transação da operação correspondente.
- O evento de confirmação de importação registra `import_batch_id`, arquivo, hash, usuário, data,
  total de linhas e resultado estruturado.
- Logs são append-only. Correções geram novos eventos e nunca reescrevem o anterior.
- Senhas, hashes de senha, tokens, cookies, JWTs, `service_role`, secrets, chaves privadas e strings de
  conexão são proibidos em `old_data`, `new_data` e `metadata`.
- Somente `ADMIN` consulta auditoria, sempre com paginação server-side de no máximo 100 linhas.
- Exportação administrativa é auditada por uma chave idempotente e não envia o conteúdo exportado ao
  logger.

## NF-e

- Somente XML é processado neste bloco; PDF não é aceito.
- Ler e revisar XML cria apenas staging. `invoices`, `invoice_items` e estoque permanecem inalterados.
- A descrição do item nunca basta para associação automática de produto.
- Código exato em `supplier_product_mappings` tem precedência; EAN só resolve quando único, ativo e
  compatível com a unidade. Qualquer outro caso exige revisão explícita.
- Todos os itens e o fornecedor precisam estar resolvidos antes da confirmação.
- A confirmação inteira é atômica e cada item entra pelo `receive_stock`.
- Chave de acesso e identidade fiscal alternativa impedem NF duplicada.
- Repetir upload do mesmo hash ou confirmação com a mesma chave não duplica efeito.
- Criar `supplier_product_mappings` durante revisão é opt-in; conflito nunca é sobrescrito.

### PDF assistido

- XML continua sendo a fonte preferencial. PDF nunca é tratado como equivalente confiável ao XML.
- Upload e extração de PDF criam somente staging `PDF`; não criam nota nem movimento.
- Campos ausentes, ambíguos, sem fuso ou sem precisão suficiente permanecem nulos.
- PDF sem camada de texto não recebe conteúdo inventado; fica em revisão e registra necessidade de
  tratamento manual ou OCR futuro.
- Fornecedor e produto encontrados por identificadores seguros são somente sugestões no PDF. Uma
  pessoa precisa selecionar as entidades antes de `READY`.
- Nome ou descrição semelhante nunca associa produto automaticamente.
- A revisão humana deve completar fornecedor, número, data/hora, ao menos um item, produto, unidade,
  quantidade e valores. Linhas descartadas são marcadas como `ignored`, não apagadas.
- Somente `confirm_pdf_invoice` promove um PDF revisado; a confirmação continua atômica, idempotente
  e usa `receive_stock` por item.

## Importação

- Arquivos externos nunca escrevem diretamente em tabelas oficiais.
- Toda linha passa por staging, validação, normalização, preview e resolução de conflitos.
- Cada execução possui `import_batch_id`, autoria, datas, origem, status e métricas.
- A confirmação é explícita e rastreável.
- Quantidades importadas geram movimentos de estoque; não sobrescrevem saldos.
- Corrigir importação confirmada não altera histórico: cria compensações e uma nova execução.
- `INITIAL_MIGRATION` pode criar cadastro e saldo inicial; saldo só nasce por
  `MIGRATION_OPENING_BALANCE` e somente em produto sem histórico ou saldo anterior.
- `MASTER_DATA_IMPORT` não altera quantidade por padrão. Uma coluna de quantidade exige decisão
  explícita entre ignorar o valor ou reconciliá-lo por ajuste rastreável.
- Produto existente só é atualizado com correspondência inequívoca e estratégia
  `UPDATE_MASTER_DATA`; `ASSOCIATE_ONLY` preserva o cadastro atual.
- Toda linha precisa estar classificada. `ERROR`, `CONFLICT`, categoria não aprovada ou preview
  inconsistente bloqueia a confirmação completa.
- Repetir um lote concluído com as mesmas opções devolve o relatório anterior sem duplicar entidades
  ou movimentos. Opções diferentes formam conflito.

## Exportação

- Exportações respeitam autorização, escopo e auditoria.
- Senhas, tokens, secrets e credenciais nunca são exportados.
- Formatos externos não definem o modelo interno; adaptadores fazem o mapeamento.

## Relatórios

- Relatórios são consultas somente-leitura e nunca alteram saldo, movimento ou staging.
- Filtros, agregações, ordenação e paginação ocorrem no PostgreSQL; o React recebe apenas a página.
- Cada página possui no máximo 100 linhas e informa o total filtrado.
- Estoque zero é `OUT_OF_STOCK`; saldo positivo menor ou igual ao mínimo é `BELOW_MINIMUM`; os
  demais casos são `OK`.
- Consumo considera `CONSUMPTION_EXIT`; entradas consideram somente notas `CONFIRMED`; migração
  considera somente `MIGRATION_OPENING_BALANCE` com `import_batch_id`.
- Quantidades e valores monetários preservam precisão decimal e são entregues como texto.
- `ADMIN`, `STOCK_OPERATOR` e `VIEWER` podem consultar relatórios quando o perfil está ativo.
- Relatório de migração não expõe dados brutos, arquivo, hash ou metadados internos do staging.
