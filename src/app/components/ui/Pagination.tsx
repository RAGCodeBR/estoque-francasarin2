interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ onPageChange, page, total, totalPages }: PaginationProps) {
  if (totalPages === 0) return null;
  return (
    <nav aria-label="Paginação" className="pagination">
      <span>{total.toLocaleString('pt-BR')} registros</span>
      <div>
        <button
          disabled={page <= 1}
          onClick={() => {
            onPageChange(page - 1);
          }}
          type="button"
        >
          Anterior
        </button>
        <strong>
          {page.toLocaleString('pt-BR')} / {totalPages.toLocaleString('pt-BR')}
        </strong>
        <button
          disabled={page >= totalPages}
          onClick={() => {
            onPageChange(page + 1);
          }}
          type="button"
        >
          Próxima
        </button>
      </div>
    </nav>
  );
}
