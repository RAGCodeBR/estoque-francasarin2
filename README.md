# Sistema de Estoque

Fundação técnica de um sistema profissional de estoque para restaurante, construído com React,
TypeScript, Vite, Supabase e PostgreSQL.

## Requisitos

- Node.js 24 (a versão LTS compatível mais recente também pode ser usada)
- npm 11+

## Configuração local

1. Copie `.env.example` para `.env.local`.
2. Informe a URL e a chave publicável do projeto Supabase.
3. Instale as dependências com `npm install`.
4. Inicie o ambiente com `npm run dev`.

Nunca coloque `service_role`, senha do banco ou connection string administrativa em variáveis
prefixadas por `VITE_`: elas são incorporadas ao bundle do navegador.

## Verificações

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

A documentação arquitetural está em [`docs`](docs/architecture.md).
