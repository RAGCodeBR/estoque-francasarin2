import type { SupabaseClient } from '@supabase/supabase-js';

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SupabaseResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

function isSupabaseResponse(value: unknown): value is SupabaseResponse {
  if (!isRecord(value) || !('data' in value) || !('error' in value)) return false;
  if (value.error === null) return true;
  if (!isRecord(value.error) || typeof value.error.message !== 'string') return false;
  return value.error.code === undefined || typeof value.error.code === 'string';
}

export async function unwrapSupabaseResponse(operation: PromiseLike<unknown>): Promise<unknown> {
  const response: unknown = await operation;
  if (!isSupabaseResponse(response)) throw new Error('Resposta inválida do Supabase.');
  if (response.error) {
    const suffix = response.error.code ? ` (${response.error.code})` : '';
    throw new Error(`${response.error.message}${suffix}`);
  }
  return response.data;
}

export async function getAuthenticatedUserId(client: SupabaseClient): Promise<string> {
  const data = await unwrapSupabaseResponse(client.auth.getUser());
  if (!isRecord(data) || !isRecord(data.user) || typeof data.user.id !== 'string') {
    throw new Error('Usuário autenticado não encontrado.');
  }
  return data.user.id;
}

export function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`Campo ${key} inválido na resposta do banco.`);
  return value;
}

export function nullableString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Campo ${key} inválido na resposta do banco.`);
  return value;
}

export function requiredBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`Campo ${key} inválido na resposta do banco.`);
  return value;
}

export function numericString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(3);
  if (typeof value === 'string' && /^\d+(?:\.\d{1,3})?$/.test(value)) {
    const [integer = '0', fraction = ''] = value.split('.');
    return `${integer}.${fraction.padEnd(3, '0')}`;
  }
  throw new Error(`Campo ${key} inválido na resposta do banco.`);
}

export interface ParsedPagePayload {
  items: readonly unknown[];
  page: number;
  pageSize: number;
  total: number;
}

export function parsePagePayload(value: unknown): ParsedPagePayload {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('Resposta paginada inválida do banco.');
  }
  const page = value.page;
  const pageSize = value.page_size;
  const total = value.total;
  if (
    typeof page !== 'number' ||
    typeof pageSize !== 'number' ||
    typeof total !== 'number' ||
    !Number.isSafeInteger(page) ||
    !Number.isSafeInteger(pageSize) ||
    !Number.isSafeInteger(total)
  ) {
    throw new Error('Metadados de paginação inválidos do banco.');
  }
  const items: readonly unknown[] = value.items;
  return { items, page, pageSize, total };
}
