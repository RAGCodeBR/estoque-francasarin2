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
- O JWT identifica o usuário com `auth.uid()`; autorização vem de perfil ativo, `roles` e
  `user_roles` no banco.
- `authenticated` sem role não acessa dados operacionais.
- Funções privilegiadas validam identidade, papel, entrada e escopo no servidor.
- Funções `SECURITY DEFINER`, quando inevitáveis, fixam `search_path` e concedem execução mínima.

### Roles

- `ADMIN`: gerencia perfis, associações de role, cadastros, notas, staging e arquivos de importação;
  consulta auditoria.
- `STOCK_OPERATOR`: consulta o estoque e prepara notas próprias em estados não confirmados. A futura
  entrada, saída e perda deverá chamar o motor transacional.
- `VIEWER`: consulta cadastros, notas, saldos, movimentos e relatórios.

Nenhuma role da aplicação recebe mutação direta de `stock_balances` ou `stock_movements`. Nem mesmo
`ADMIN` substitui o futuro motor transacional.

Novos usuários recebem perfil, mas nenhuma role automática. O bootstrap do primeiro `ADMIN` deve
ser feito uma única vez pelo SQL Editor ou outro ambiente administrativo confiável, nunca pelo
frontend. O último administrador ativo não pode ser removido nem desativado.

Depois de criar o primeiro usuário no Supabase Auth, o bootstrap usa o UUID real desse usuário nos
dois parâmetros abaixo:

```sql
insert into public.user_roles (profile_id, role_id, granted_by)
select 'UUID_DO_USUARIO'::uuid, id, 'UUID_DO_USUARIO'::uuid
from public.roles
where code = 'ADMIN';
```

Esse procedimento não utiliza `service_role` no navegador e não deve ser transformado em endpoint
público.

### Storage

O bucket `import-files` é privado, limitado a 10 MiB e aceita apenas MIME types configurados para
CSV/XLSX. Todas as operações de objetos exigem `ADMIN` via RLS. Caminhos e nomes de objetos não
concedem autorização por si mesmos.

## Operações críticas

Validação no cliente melhora a experiência, mas não constitui controle de segurança. Atomicidade,
idempotência, limites de quantidade, não negatividade e imutabilidade do histórico devem ser
impostos pelo banco ou backend confiável. Logs não devem conter tokens, credenciais ou conteúdo
sensível desnecessário.

Policies restringem linhas e grants por coluna preservam autoria e datas de criação. Histórico e
auditoria não possuem mutações concedidas à Data API; `stock_movements` e `audit_logs` mantêm também
triggers contra edição e exclusão.

## Dependências

O lockfile deve ser versionado. Atualizações precisam passar pelos quatro gates de qualidade e por
análise de vulnerabilidades compatível com o risco antes da implantação.
