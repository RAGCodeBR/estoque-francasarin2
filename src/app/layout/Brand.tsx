export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span aria-hidden="true" className="brand__mark">
        <span>F</span>
      </span>
      <span className="brand__copy">
        <strong>Françasarin</strong>
        <small>Gestão de estoque</small>
      </span>
    </div>
  );
}
