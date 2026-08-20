# Backup e restauração

## Escopo desta etapa

Nenhuma automação de backup é criada no Bloco 0. A estratégia final dependerá do ambiente Supabase,
requisitos de retenção e objetivos de recuperação acordados.

## Princípios

- Definir e documentar RPO (perda máxima aceitável) e RTO (tempo máximo de recuperação).
- Manter backups criptografados, com acesso mínimo, retenção definida e cópia fora do domínio de
  falha principal.
- Proteger banco, objetos armazenados, migrações, configurações necessárias e metadados de
  importação.
- Nunca incluir secrets em exports de negócio ou artefatos versionados.
- Tratar um backup como válido somente após teste periódico de restauração.

## Procedimento futuro de restauração

1. Declarar incidente, responsável e ponto de recuperação aprovado.
2. Preservar evidências e impedir novas escritas quando necessário.
3. Restaurar em ambiente isolado.
4. Aplicar migrações compatíveis e validar integridade referencial.
5. Reconciliar produtos, saldos e `stock_movements`, incluindo lotes de importação.
6. Executar testes funcionais, de segurança e autorização.
7. Promover de forma controlada, registrar auditoria e monitorar.

Testes de restauração devem verificar especialmente que o histórico permanente continua íntegro e
que nenhuma reaplicação de operação idempotente duplica efeitos.
