# Ensaio de migração dos dados reais

## Objetivo e barreira de segurança

Este procedimento prepara a análise do arquivo real do sistema anterior sem escrever no Supabase,
no staging ou nas tabelas oficiais. O comando entregue neste bloco não possui opção de confirmar,
promover ou importar dados.

O fluxo obrigatório é:

```text
arquivo original
  → leitura e SHA-256
  → cópia preservada e somente leitura
  → verificação byte a byte por SHA-256
  → inventário de planilhas/tabelas
  → análise de colunas, tipos, valores e problemas
  → proposta não aplicada de ColumnMapping/ValueMapping
  → revisão humana
  → novo relatório com mapeamento confirmado
  → staging
  → dry-run
  → relatório do dry-run
  → preparação de confirmação administrativa
```

Produção não faz parte deste comando nem deste bloco.

## Custódia do arquivo

O arquivo recebido deve permanecer em seu local original. Recomenda-se criar o diretório de
evidências fora do repositório e em volume com backup e controle de acesso.

No PowerShell:

```powershell
npm run migration:analyze -- --source "D:\legado\estoque.xlsx" --evidence-dir "D:\migration-evidence"
```

O comando:

1. abre o original apenas para leitura;
2. calcula SHA-256 sobre os bytes originais;
3. cria uma pasta identificada pelo nome sanitizado e pelos 12 primeiros caracteres do hash;
4. copia com semântica de criação exclusiva, sem sobrescrever arquivo existente;
5. recalcula o hash da cópia;
6. recalcula o hash do original após a cópia;
7. marca a cópia como somente leitura;
8. cria `custody-manifest.json`;
9. analisa exclusivamente os bytes da cópia preservada;
10. grava uma nova pasta de relatório por execução.

Estrutura esperada:

```text
<evidence-dir>/
  estoque-<hash-curto>/
    custody-manifest.json
    original-read-only/
      estoque.xlsx
    reports/
      <timestamp>/
        analysis.json
        analysis.md
```

O atributo somente leitura é uma barreira operacional, não armazenamento WORM. A prova de
integridade é o SHA-256 registrado e revalidado. A evidência deve continuar protegida por backup,
permissões do sistema operacional e retenção administrativa.

`migration-evidence/` está no `.gitignore`, mas o recomendado é não colocar dados reais dentro do
repositório.

## Primeira análise sem configuração

Na primeira execução, o analisador não precisa conhecer os cabeçalhos. Ele:

- aceita CSV e XLSX;
- identifica o formato pela extensão e valida a estrutura real;
- lista todas as planilhas do XLSX, inclusive vazias ou inválidas;
- analisa cada planilha de forma independente;
- identifica a linha de cabeçalho ou permite configurá-la;
- lista colunas e posição;
- conta preenchidos, vazios e valores únicos;
- infere tipos lexicais observados: texto, inteiro, decimal, data e booleano;
- inclui amostras e frequências de valores;
- propõe destinos apenas como hipótese explícita;
- classifica campos ambíguos como `REVIEW_REQUIRED`;
- rejeita fórmulas, macros, conteúdo ativo e estruturas XLSX inseguras sem executá-los.

A lista de valores distintos no relatório é limitada por padrão a 50 por coluna. A contagem de
valores únicos permanece completa dentro do limite total de linhas do importador.

## Relatório de qualidade

Para cada origem analisada, `analysis.md` e `analysis.json` apresentam:

- total de linhas/produtos candidatos;
- SKUs únicos;
- grupos de SKUs duplicados e respectivas linhas;
- EANs informados, únicos, válidos e inválidos;
- categorias e frequências;
- tipos de produto e frequências;
- unidades e frequências;
- produtos sem categoria;
- produtos sem unidade;
- quantidades atuais ou mínimas inválidas;
- quantidades atuais ou mínimas negativas;
- candidatos a duplicidade por nome normalizado ou EAN;
- campos desconhecidos ou ambíguos;
- problemas com severidade, linha, campo, valor e ação sugerida.

Contagens baseadas em proposta de alta confiança são preliminares e devem ser conferidas no segundo
relatório. Quando a coluna é ambígua ou desconhecida, o resultado aparece como `NÃO IDENTIFICADO`.
Isso evita apresentar uma suposição fraca como dado definitivo.

## Proposta de ColumnMapping

A análise inicial usa aliases somente para propor um mapeamento. Nenhuma proposta é aplicada ao
arquivo ou enviada ao staging. Confiança `MEDIUM`, destinos duplicados e campos desconhecidos exigem
revisão.

Toda coluna precisa terminar com uma decisão explícita:

```text
ORIGINAL → campo canônico
```

ou:

```text
ORIGINAL → IGNORE
```

O exemplo versionado está em `docs/examples/legacy-analysis-config.example.json`. Para XLSX, a
chave dentro de `sourceConfigurations` deve ser o nome exato da planilha, em vez de `CSV`.

Depois de revisar uma cópia do exemplo, executar:

```powershell
npm run migration:analyze -- --source "D:\legado\estoque.xlsx" --evidence-dir "D:\migration-evidence" --config "D:\migration-work\analysis-config.json"
```

O mapeamento configurado deve decidir todas as colunas e conter os campos obrigatórios do cadastro.
Configurações incompletas, destinos repetidos ou colunas inexistentes produzem erro no relatório e
não avançam.

## Transformações documentadas

O relatório lista valores únicos que precisariam ser transformados, sempre com ocorrência e estado:

```text
ORIGINAL | DESTINO | OCORRÊNCIAS | ESTADO
UNIDADE  | UN      | 34          | PROPOSED
KILO     | KG      | 18          | PROPOSED
CX       | REVISAR | 2           | REVIEW_REQUIRED
```

Também são documentadas normalizações de SKU, espaços, EAN e quantidades decimais. O valor original
continua intocado. Um destino `REVISAR` bloqueia a preparação do dry-run até existir decisão de
`ValueMapping` ou correção documentada na cópia de trabalho.

## Configuração do CSV

O arquivo opcional de configuração permite declarar:

- delimitador: vírgula, ponto e vírgula, tab ou `|`;
- encoding: UTF-8, Windows-1252, UTF-16 LE ou UTF-16 BE;
- número da linha de cabeçalho;
- ColumnMapping por origem;
- ValueMapping de unidade e tipo.

Não converter o arquivo original para “facilitar” a leitura. Se uma conversão for necessária, criar
uma cópia de trabalho adicional e registrar os hashes de origem e destino.

## XLSX com múltiplas planilhas

Todas as planilhas são inventariadas antes da escolha da tabela principal. Planilhas vazias aparecem
como `EMPTY`; planilhas com fórmulas ou conteúdo rejeitado aparecem como `ERROR`. Um problema em uma
planilha não executa seu conteúdo nem oculta os nomes das demais.

Não assumir que a primeira planilha contém produtos. A candidatura depende de SKU e nome mapeados de
forma inequívoca.

## Do relatório ao dry-run

Somente depois de revisar o segundo relatório:

1. confirmar a origem que contém produtos;
2. confirmar cada ColumnMapping e `IGNORE`;
3. confirmar cada ValueMapping;
4. resolver SKUs duplicados, EANs inválidos, campos obrigatórios e quantidades;
5. manter o original e a evidência somente leitura;
6. criar `import_batch` e `import_rows` pelo fluxo administrativo existente;
7. executar dry-run;
8. comparar o relatório do dry-run com o relatório offline;
9. impedir confirmação enquanto houver `ERROR` ou `CONFLICT`;
10. preparar confirmação somente em ambiente de teste.

Quantidade atual da migração inicial continua sendo convertida em
`MIGRATION_OPENING_BALANCE`. Nunca executar `UPDATE stock_balances` com o valor do arquivo.

## Critérios para interromper o ensaio

Interromper antes do staging quando ocorrer qualquer um destes casos:

- hash da cópia diferente do original;
- original mudou durante a preservação;
- formato inválido ou não suportado;
- fórmula, macro, objeto ativo ou container inseguro;
- cabeçalhos duplicados ou vazios;
- tabela de produtos não identificada;
- ColumnMapping ambíguo ou incompleto;
- ValueMapping desconhecido;
- SKU duplicado;
- quantidade negativa ou inválida;
- EAN inválido sem decisão documentada.

Nenhuma dessas situações deve ser corrigida silenciosamente.
