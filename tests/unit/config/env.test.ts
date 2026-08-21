import { describe, expect, it } from 'vitest';

import { getClientEnv } from '../../../src/config/env';

describe('getClientEnv', () => {
  it('retorna somente a configuração pública esperada', () => {
    expect(
      getClientEnv({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'public-key',
        SERVICE_ROLE_KEY: 'must-not-leak',
      }),
    ).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'public-key',
    });
  });

  it.each(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])(
    'falha quando %s está ausente',
    (missingName) => {
      const source: Record<string, string | undefined> = {
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'public-key',
      };

      source[missingName] = undefined;

      expect(() => getClientEnv(source)).toThrow(
        `Variável de ambiente obrigatória ausente: ${missingName}`,
      );
    },
  );

  it('rejeita valores formados somente por espaços', () => {
    expect(() =>
      getClientEnv({
        VITE_SUPABASE_URL: '   ',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'public-key',
      }),
    ).toThrow('Variável de ambiente obrigatória ausente: VITE_SUPABASE_URL');
  });

  it.each([
    'sb_secret_example',
    'service_role_key',
    'e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
  ])('rejeita credencial administrativa no bundle Vite', (key) => {
    expect(() =>
      getClientEnv({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toThrow(/não pode conter uma chave administrativa/i);
  });
});
