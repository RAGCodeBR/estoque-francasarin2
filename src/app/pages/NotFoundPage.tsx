import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="not-found-page">
      <span>404</span>
      <h1>Página não encontrada</h1>
      <p>O endereço informado não existe ou foi movido.</p>
      <Link className="button button--primary" to="/dashboard">
        Voltar ao dashboard
      </Link>
    </main>
  );
}
