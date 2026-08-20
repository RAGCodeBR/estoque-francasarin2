# Módulos

Cada diretório representa uma fronteira funcional. Nenhuma funcionalidade de negócio é
implementada na fundação. Código compartilhado só deve sair de um módulo quando tiver uso real em
mais de um contexto.

- `auth`: autenticação e sessão.
- `products`: cadastro de produtos.
- `inventory`: saldos e motor transacional de estoque.
- `invoices`: notas e documentos de entrada.
- `locations`: locais físicos de armazenamento.
- `categories`: classificação de produtos.
- `suppliers`: fornecedores.
- `losses`: perdas e baixas justificadas.
- `reports`: consultas e relatórios.
- `audit`: rastreabilidade e auditoria.
- `data-import`: pipeline seguro de importação.
- `data-export`: exportações autorizadas e sanitizadas.
