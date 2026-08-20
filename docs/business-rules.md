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
- No modelo central atual, transferências preservam a quantidade agregada e registram os dois locais.
- Cada produto pode possuir no máximo um marco `MIGRATION_OPENING_BALANCE`, sempre vinculado a um
  lote de importação válido e identificado como `Migração sistema legado`.

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
