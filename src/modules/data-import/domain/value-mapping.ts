import { ImportFileError } from './errors';
import type { ImportValueMappings, ValueMapping } from './types';

const defaultValueMappings = {
  unit: Object.freeze([
    { sourceValue: 'UN', targetValue: 'UN' },
    { sourceValue: 'UND', targetValue: 'UN' },
    { sourceValue: 'UNID', targetValue: 'UN' },
    { sourceValue: 'UNIDADE', targetValue: 'UN' },
    { sourceValue: 'PC', targetValue: 'UN' },
    { sourceValue: 'PECA', targetValue: 'UN' },
    { sourceValue: 'KG', targetValue: 'KG' },
    { sourceValue: 'KILO', targetValue: 'KG' },
    { sourceValue: 'KILOGRAMA', targetValue: 'KG' },
    { sourceValue: 'KGS', targetValue: 'KG' },
  ]),
  productType: Object.freeze([
    { sourceValue: 'RAW', targetValue: 'RAW' },
    { sourceValue: 'BRUTO', targetValue: 'RAW' },
    { sourceValue: 'MP', targetValue: 'RAW' },
    { sourceValue: 'MATERIA PRIMA', targetValue: 'RAW' },
    { sourceValue: 'B', targetValue: 'RAW' },
    { sourceValue: '1', targetValue: 'RAW' },
    { sourceValue: 'FRACTIONATED', targetValue: 'FRACTIONATED' },
    { sourceValue: 'FRACIONADO', targetValue: 'FRACTIONATED' },
    { sourceValue: 'F', targetValue: 'FRACTIONATED' },
    { sourceValue: '2', targetValue: 'FRACTIONATED' },
  ]),
} as const satisfies ImportValueMappings;

export const DEFAULT_VALUE_MAPPINGS: ImportValueMappings = Object.freeze(defaultValueMappings);

export function normalizeMappingValue(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .replaceAll(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

export function compileValueMapping<TTarget extends string>(
  defaults: readonly ValueMapping<TTarget>[],
  custom: readonly ValueMapping<TTarget>[] = [],
): ReadonlyMap<string, TTarget> {
  const compiled = new Map<string, TTarget>();

  for (const entry of defaults) {
    compiled.set(normalizeMappingValue(entry.sourceValue), entry.targetValue);
  }

  const customSources = new Map<string, TTarget>();
  for (const entry of custom) {
    const source = normalizeMappingValue(entry.sourceValue);
    if (!source) {
      throw new ImportFileError(
        'INVALID_VALUE_MAPPING',
        'ValueMapping não pode possuir valor de origem vazio.',
      );
    }
    const previous = customSources.get(source);
    if (previous !== undefined && previous !== entry.targetValue) {
      throw new ImportFileError(
        'INVALID_VALUE_MAPPING',
        `ValueMapping contraditório para o valor ${entry.sourceValue}.`,
      );
    }
    customSources.set(source, entry.targetValue);
    compiled.set(source, entry.targetValue);
  }

  return compiled;
}
