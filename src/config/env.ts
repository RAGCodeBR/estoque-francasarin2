export interface ClientEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

type EnvSource = Readonly<Record<string, string | boolean | undefined>>;

function requireEnv(source: EnvSource, name: string): string {
  const value = source[name];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }

  return value.trim();
}

function jwtRole(value: string): string | null {
  const payload = value.split('.')[1];
  if (!payload) return null;

  try {
    const padded = payload
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded: unknown = JSON.parse(atob(padded));
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;
    const role = (decoded as Readonly<Record<string, unknown>>).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

function requirePublishableKey(source: EnvSource): string {
  const key = requireEnv(source, 'VITE_SUPABASE_PUBLISHABLE_KEY');
  if (
    /^sb_secret_/i.test(key) ||
    /service[_-]?role/i.test(key) ||
    jwtRole(key) === 'service_role'
  ) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY não pode conter uma chave administrativa.');
  }
  return key;
}

export function getClientEnv(source: EnvSource = import.meta.env): ClientEnv {
  return {
    supabaseUrl: requireEnv(source, 'VITE_SUPABASE_URL'),
    supabasePublishableKey: requirePublishableKey(source),
  };
}
