# Segurança

## Segredos

Somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são aceitos no frontend. Qualquer
variável `VITE_` pode ser lida por quem baixar o bundle. Portanto `service_role`, senhas do banco,
JWT secrets e connection strings administrativas são proibidos no frontend, no Git e em fixtures.

Segredos de backend devem ser mantidos no gerenciador de secrets do ambiente de execução. O arquivo
`.env.example` contém apenas nomes e exemplos não funcionais; arquivos `.env*` reais são ignorados.

## Autorização

- RLS é obrigatória em toda tabela exposta.
- Grants e exposição pela Data API são explícitos e mínimos.
- Políticas são testadas com identidades permitidas e negadas.
- `user_metadata` não concede privilégios.
- Funções privilegiadas validam identidade, papel, entrada e escopo no servidor.
- Funções `SECURITY DEFINER`, quando inevitáveis, fixam `search_path` e concedem execução mínima.

## Operações críticas

Validação no cliente melhora a experiência, mas não constitui controle de segurança. Atomicidade,
idempotência, limites de quantidade, não negatividade e imutabilidade do histórico devem ser
impostos pelo banco ou backend confiável. Logs não devem conter tokens, credenciais ou conteúdo
sensível desnecessário.

## Dependências

O lockfile deve ser versionado. Atualizações precisam passar pelos quatro gates de qualidade e por
análise de vulnerabilidades compatível com o risco antes da implantação.
