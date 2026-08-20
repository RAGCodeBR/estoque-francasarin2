# Módulos

Cada diretório representa uma fronteira funcional. Código compartilhado só deve sair de um módulo
quando tiver uso real em mais de um contexto. Módulos implementados expõem sua API pelo próprio
`index.ts` e não dependem de telas.

- `auth`: Supabase Auth, sessão, roles e permissões headless; RLS permanece como autoridade final.
- `products`: criação, consulta, pesquisa paginada, edição e ciclo ativo de produtos, sem saldo.
- `inventory`: saldos, motor transacional, saídas e inventários físicos reconciliados por ajustes.
- `invoices`: XML preferencial e PDF assistido, com staging, revisão e confirmação transacional.
- `locations`: cadastro paginado e ciclo ativo de locais `STOCK`/`CONSUMPTION`.
- `categories`: cadastro paginado e ciclo ativo de classificações.
- `suppliers`: cadastro paginado e ciclo ativo de fornecedores.
- `losses`: perdas rastreáveis com motivo, observação e movimento `LOSS` obrigatório.
- `reports`: seis consultas headless, filtradas e paginadas no PostgreSQL, sem mutações.
- `audit`: consulta administrativa paginada, eventos imutáveis e registro seguro de exportações.
- `data-import`: pipeline seguro de CSV/XLSX, staging, validação, dry-run e confirmação transacional.
- `data-export`: exportações autorizadas e sanitizadas.
