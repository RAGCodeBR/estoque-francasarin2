import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getClientEnv } from '../../config/env';

let browserClient: SupabaseClient | undefined;

/**
 * Cria uma única instância do cliente público. Nenhuma credencial administrativa
 * pode ser usada aqui, pois todo conteúdo VITE_ é enviado ao navegador.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!browserClient) {
    const env = getClientEnv();

    browserClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
