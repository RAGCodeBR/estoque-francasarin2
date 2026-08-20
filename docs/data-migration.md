# Migração e importação de dados

## Contexto

O sistema legado contém mais de 600 produtos, mas nomes de colunas, tabelas, IDs, relacionamentos,
tipos e formatos de exportação ainda são desconhecidos. A arquitetura não acoplará o domínio ao
formato legado.

## Pipeline obrigatório

1. **Ingestão:** recebe arquivo ou payload original, calcula checksum e cria um lote imutável.
2. **Staging:** persiste os registros brutos isolados das tabelas oficiais com `import_batch_id` e
   número da linha de origem.
3. **Mapeamento:** associa campos externos a um modelo canônico versionado.
4. **Normalização:** trata espaços, encoding, unidades, números, datas e valores ausentes sem perder
   o valor original.
5. **Validação:** classifica erros e avisos por linha e por campo.
6. **Preview:** exibe totais, amostras, mudanças propostas e impactos antes de qualquer confirmação.
7. **Conflitos:** exige regra explícita para duplicidades, referências ausentes e correspondências
   ambíguas; nenhuma decisão crítica é silenciosa.
8. **Confirmação:** usuário autorizado aprova uma versão estável do lote.
9. **Aplicação:** uma operação idempotente promove dados válidos de forma transacional.
10. **Auditoria:** registra autor, datas, arquivo, checksum, mapeamento, decisões, resultados e erros.

## Independência de formato

Adaptadores de entrada serão responsáveis por CSV, XLSX, JSON ou outro formato comprovadamente
necessário. Todos produzem o mesmo modelo canônico. Mapeamentos terão versão e poderão ser salvos por
origem sem inserir regras específicas do legado nas tabelas de domínio.

## Estoque inicial e correções

Quantidade importada nunca atualiza saldo diretamente. A aplicação do lote cria movimentos de carga
inicial ou ajuste, com referência ao `import_batch_id`. Reprocessar a mesma chave idempotente não
duplica movimentos. Após confirmação, correções criam movimentos compensatórios e um novo lote; não
alteram nem apagam o histórico anterior.

## Critérios antes da migração real

- Obter uma exportação representativa e documentar encoding, delimitadores, fórmulas e unidades.
- Inventariar chaves, duplicidades, campos obrigatórios e qualidade dos dados.
- Definir reconciliação por contagens, totais e amostragem.
- Ensaiar em ambiente isolado com backup e plano de reversão.
- Obter aprovação explícita do preview e do relatório de reconciliação.
