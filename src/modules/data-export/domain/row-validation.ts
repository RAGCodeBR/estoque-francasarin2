import type { ExportDefinition, ExportLimits, ExportRow } from './types';

const FORBIDDEN_FIELD =
  /^(?:password|passwd|password_hash|token|access_token|refresh_token|secret|secret_key|service_role|service_role_key|credential|credentials|authorization|cookie|database_url|connection_string|jwt|jwt_secret|private_key|client_secret|api_secret)$/i;

export function validateExportRow(
  row: ExportRow,
  definition: ExportDefinition,
  limits: ExportLimits,
): void {
  const expected = new Set(definition.columns.map(({ key }) => key));
  const actual = Object.keys(row);

  for (const key of actual) {
    if (FORBIDDEN_FIELD.test(key)) {
      throw new Error(`Campo sensível proibido na exportação: ${key}.`);
    }
    if (!expected.has(key)) throw new Error(`Campo inesperado na exportação: ${key}.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(row, key)) throw new Error(`Campo ausente na exportação: ${key}.`);
    const value = row[key];
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean') {
      throw new Error(`Valor inválido na coluna exportada ${key}.`);
    }
    if (typeof value === 'string' && value.length > limits.maxCellLength) {
      throw new Error(`Valor da coluna ${key} excede o limite do formato.`);
    }
  }
}
