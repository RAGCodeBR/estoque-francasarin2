import type { ReactNode } from 'react';

export interface TableColumn<Row> {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<Row> {
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  getRowKey: (row: Row) => string;
  emptyContent: ReactNode;
  caption: string;
  isLoading?: boolean;
}

export function DataTable<Row>({
  caption,
  columns,
  emptyContent,
  getRowKey,
  isLoading = false,
  rows,
}: DataTableProps<Row>) {
  return (
    <div className="data-table-shell">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" style={{ textAlign: column.align ?? 'left' }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 5 }, (_, index) => (
                <tr key={`loading-${String(index)}`}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <span className="skeleton skeleton--cell" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr key={getRowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!isLoading && rows.length === 0 ? (
        <div className="data-table__empty">{emptyContent}</div>
      ) : null}
    </div>
  );
}
