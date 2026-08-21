export function LoadingState({ label = 'Carregando sistema' }: { label?: string }) {
  return (
    <div aria-live="polite" className="full-page-state" role="status">
      <div className="loading-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </div>
  );
}
