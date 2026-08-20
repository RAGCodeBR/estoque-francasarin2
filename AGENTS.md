# Regras obrigatórias do projeto

Estas regras valem para todo o repositório e devem ser preservadas em qualquer implementação futura.

1. Nunca alterar saldo diretamente pelo frontend.
2. Toda alteração de estoque deve passar pelo motor transacional.
3. `stock_movements` é histórico permanente.
4. Movimentações concluídas nunca podem ser editadas ou excluídas.
5. Correções criam movimentações compensatórias.
6. Operações de estoque devem ser atômicas.
7. Operações críticas devem ser idempotentes.
8. Estoque negativo é proibido por padrão.
9. Toda movimentação deve possuir usuário, data e rastreabilidade.
10. Todas as tabelas expostas devem possuir RLS.
11. Nunca utilizar `service_role` no frontend.
12. Nunca utilizar `user_metadata` como fonte de autorização.
13. Regras críticas não devem depender do React.
14. Quantidades devem utilizar `NUMERIC`, nunca `FLOAT`.
15. Dados importados nunca entram diretamente nas tabelas oficiais sem validação.
16. Toda importação deverá passar por staging e validação.
17. Importações devem possuir `import_batch_id`.
18. Importações devem ser rastreáveis.
19. Importações críticas devem ser idempotentes.
20. Nunca sobrescrever estoque silenciosamente durante importação.
21. Importação de quantidade deve gerar movimentação de estoque.
22. Nunca alterar ou apagar histórico para corrigir importação.
23. Exportações não podem expor senhas, tokens ou secrets.
24. Não presumir que tabela `public` está automaticamente exposta pela Data API.
25. Configurar explicitamente exposição/grants somente quando necessário e sempre em conjunto com RLS.
26. Toda implementação importante deve possuir testes.
27. Não considerar tarefa concluída com lint, typecheck ou testes falhando.

## Limites arquiteturais

- O frontend usa apenas credenciais públicas explicitamente permitidas.
- Segredos administrativos pertencem exclusivamente a ambientes seguros de backend.
- Migrações de banco são versionadas em `supabase/migrations`.
- Regras críticas e transações devem ser implementadas no banco ou em backend confiável.
- Execute `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` antes de concluir alterações.
