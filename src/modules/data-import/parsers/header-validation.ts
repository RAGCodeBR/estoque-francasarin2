import { ImportFileError } from '../domain/errors';

export function normalizeHeaderIdentity(header: string): string {
  return header.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
}

export function validateHeaders(values: readonly (string | null)[]): readonly string[] {
  const headers = values.map((value, index) => {
    const header = value?.normalize('NFKC').trim() ?? '';

    if (header === '') {
      throw new ImportFileError('EMPTY_HEADER', `Cabeçalho vazio na coluna ${String(index + 1)}.`, {
        columnNumber: index + 1,
      });
    }

    return header;
  });

  const identities = new Map<string, string>();

  for (const header of headers) {
    const identity = normalizeHeaderIdentity(header);
    const duplicate = identities.get(identity);

    if (duplicate) {
      throw new ImportFileError(
        'DUPLICATE_COLUMN',
        `Colunas duplicadas não são permitidas: "${duplicate}" e "${header}".`,
        { columns: [duplicate, header] },
      );
    }

    identities.set(identity, header);
  }

  return headers;
}

export function looksLikeFormula(value: string): boolean {
  const normalized = value.trimStart();

  if (normalized.startsWith('=') || normalized.startsWith('@')) {
    return true;
  }

  if (!normalized.startsWith('+') && !normalized.startsWith('-')) {
    return false;
  }

  return !/^[+-]\d+(?:[.,]\d+)?$/.test(normalized);
}
