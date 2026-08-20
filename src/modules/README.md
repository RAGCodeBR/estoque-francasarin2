# Módulos

Cada diretório representa uma fronteira funcional. Código compartilhado só deve sair de um módulo
quando tiver uso real em mais de um contexto. Módulos implementados expõem sua API pelo próprio
`index.ts` e não dependem de telas.

- `auth`: Supabase Auth, sessão, roles e permissões headless; RLS permanece como autoridade final.
- `products`: criação, consulta, pesquisa paginada, edição e ciclo ativo de produtos, sem saldo.
- `inventory`: saldos e motor transacional de estoque.
- `invoices`: XML preferencial e PDF assistido, com staging, revisão e confirmação transacional.
- `locations`: cadastro paginado e ciclo ativo de locais `STOCK`/`CONSUMPTION`.
- `categories`: cadastro paginado e ciclo ativo de classificações.
- `suppliers`: cadastro paginado e ciclo ativo de fornecedores.
- `losses`: perdas e baixas justificadas.
- `reports`: consultas e relatórios.
- `audit`: rastreabilidade e auditoria.
- `data-import`: pipeline seguro de CSV/XLSX, staging, validação, dry-run e confirmação transacional.
- `data-export`: exportações autorizadas e sanitizadas.
