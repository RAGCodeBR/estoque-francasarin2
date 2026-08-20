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

  return value;
}

export function getClientEnv(source: EnvSource = import.meta.env): ClientEnv {
  return {
    supabaseUrl: requireEnv(source, 'VITE_SUPABASE_URL'),
    supabasePublishableKey: requireEnv(source, 'VITE_SUPABASE_PUBLISHABLE_KEY'),
  };
}
