# Regras de negócio invariáveis

## Estoque

- O frontend nunca escreve saldo diretamente.
- Toda entrada, saída, transferência, perda, ajuste ou carga inicial passa pelo motor transacional.
- Cada operação é atômica: movimento e efeito no saldo confirmam juntos ou são revertidos juntos.
- Movimentos concluídos são permanentes e imutáveis.
- Correções usam movimentos compensatórios; o histórico original permanece intacto.
- Estoque negativo é proibido por padrão.
- Cada movimento registra autor, instante, origem, motivo e identificadores de correlação.
- Repetir uma solicitação crítica com a mesma chave de idempotência não duplica seu efeito.

## Importação

- Arquivos externos nunca escrevem diretamente em tabelas oficiais.
- Toda linha passa por staging, validação, normalização, preview e resolução de conflitos.
- Cada execução possui `import_batch_id`, autoria, datas, origem, status e métricas.
- A confirmação é explícita e rastreável.
- Quantidades importadas geram movimentos de estoque; não sobrescrevem saldos.
- Corrigir importação confirmada não altera histórico: cria compensações e uma nova execução.

## Exportação

- Exportações respeitam autorização, escopo e auditoria.
- Senhas, tokens, secrets e credenciais nunca são exportados.
- Formatos externos não definem o modelo interno; adaptadores fazem o mapeamento.
