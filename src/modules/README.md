# Módulos

Cada diretório representa uma fronteira funcional. Código compartilhado só deve sair de um módulo
quando tiver uso real em mais de um contexto. Módulos implementados expõem sua API pelo próprio
`index.ts` e não dependem de telas.

- `auth`: Supabase Auth, sessão, roles e permissões headless; RLS permanece como autoridade final.
- `products`: cadastro de produtos.
- `inventory`: saldos e motor transacional de estoque.
- `invoices`: notas e documentos de entrada.
- `locations`: locais físicos de armazenamento.
- `categories`: classificação de produtos.
- `suppliers`: fornecedores.
- `losses`: perdas e baixas justificadas.
- `reports`: consultas e relatórios.
- `audit`: rastreabilidade e auditoria.
- `data-import`: pipeline seguro de CSV/XLSX até staging, ValueMapping, validação, identificação e
  dry-run bloqueável.
- `data-export`: exportações autorizadas e sanitizadas.
