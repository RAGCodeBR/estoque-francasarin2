import type { OperationalExportFormat } from '../domain/types';
import { serializeExport } from '../formatters/serialize-export';
import type { ExportDocumentInput, SerializedExport } from '../formatters/types';

interface WorkerResponse {
  readonly result?: SerializedExport;
  readonly error?: string;
}

export async function serializeExportInWorker(
  format: OperationalExportFormat,
  input: ExportDocumentInput,
): Promise<SerializedExport> {
  if (typeof Worker === 'undefined') {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    return serializeExport(format, input);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      finish();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      if (!event.data.result) {
        reject(new Error('O gerador em segundo plano retornou uma resposta inválida.'));
        return;
      }
      resolve(event.data.result);
    };
    worker.onerror = () => {
      finish();
      reject(new Error('Não foi possível gerar a exportação em segundo plano.'));
    };
    worker.postMessage({ format, input });
  });
}
