# Arquitetura

## Objetivo desta fundação

O projeto é um monólito modular no frontend, com React e TypeScript, apoiado por Supabase e
PostgreSQL. Esta etapa estabelece limites, ferramentas e contratos de segurança; ela não contém
telas nem regras de negócio de estoque.

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

## Cliente Supabase

`getSupabaseClient` cria sob demanda uma instância única para o navegador. A inicialização tardia
permite executar verificações e gerar o bundle sem inventar credenciais. A aplicação falha de forma
explícita quando tentar usar Supabase sem as duas variáveis públicas obrigatórias.

## Qualidade

TypeScript usa modo estrito e verificações adicionais. ESLint aplica regras tipadas, Prettier
padroniza a formatação e Vitest executa testes. O gate mínimo de conclusão é lint, typecheck, testes
e build sem falhas.
