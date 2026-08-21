import { useState, type SyntheticEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { signInWithPassword } from '../../modules/auth';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../components/feedback/toast-context';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Brand } from '../layout/Brand';

function requestedPath(state: unknown): string {
  if (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'string' &&
    state.from.startsWith('/')
  ) {
    return state.from;
  }
  return '/dashboard';
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('email e senha são obrigatórios')) return 'Informe o email e a senha.';
  if (message.includes('invalid login credentials')) return 'Email ou senha inválidos.';
  if (message.includes('email not confirmed')) return 'Confirme seu email antes de entrar.';
  return 'Não foi possível entrar agora. Verifique os dados e tente novamente.';
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useToast();

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await signInWithPassword(email, password);
      await auth.refresh();
      notify({
        title: 'Acesso autorizado',
        description: 'Bem-vindo ao sistema de estoque.',
        tone: 'success',
      });
      await navigate(requestedPath(location.state), { replace: true });
    } catch (error) {
      setFormError(friendlyAuthError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-page__story" aria-label="Apresentação do sistema">
        <Brand />
        <div className="login-page__story-copy">
          <span className="login-page__kicker">OPERAÇÃO SEGURA E RASTREÁVEL</span>
          <h1>Estoque organizado, do recebimento ao consumo.</h1>
          <p>Uma base única para produtos, movimentações, inventários e decisões da equipe.</p>
        </div>
        <div className="login-page__security-note">
          <span aria-hidden="true" className="status-dot" />
          <span>
            <strong>Dados protegidos</strong>
            <small>Acesso controlado por perfil e políticas no banco</small>
          </span>
        </div>
      </section>

      <section className="login-page__form-panel">
        <div className="login-card">
          <div className="login-card__mobile-brand">
            <Brand />
          </div>
          <div className="login-card__heading">
            <span>ACESSO AO SISTEMA</span>
            <h2>Bem-vindo de volta</h2>
            <p>Use suas credenciais para continuar.</p>
          </div>

          <form
            className="login-form"
            noValidate
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <FormField
              autoComplete="email"
              label="Email"
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              placeholder="seuemail@empresa.com"
              required
              type="email"
              value={email}
            />
            <FormField
              autoComplete="current-password"
              label="Senha"
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              placeholder="Digite sua senha"
              required
              type="password"
              value={password}
            />
            {formError ? (
              <div className="login-form__error" role="alert">
                {formError}
              </div>
            ) : null}
            <Button className="login-form__submit" isLoading={submitting} type="submit">
              Entrar no sistema
            </Button>
          </form>

          <p className="login-card__support">
            Problemas para acessar? Procure um administrador do sistema.
          </p>
        </div>
        <p className="login-page__footer">© 2026 Françasarin · Gestão de estoque</p>
      </section>
    </main>
  );
}
