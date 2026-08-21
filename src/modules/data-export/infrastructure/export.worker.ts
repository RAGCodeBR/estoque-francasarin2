import type { OperationalExportFormat } from '../domain/types';
import { serializeExport } from '../formatters/serialize-export';
import type { ExportDocumentInput, SerializedExport } from '../formatters/types';

interface WorkerRequest {
  readonly format: OperationalExportFormat;
  readonly input: ExportDocumentInput;
}

interface WorkerResponse {
  readonly result?: SerializedExport;
  readonly error?: string;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event) => {
  try {
    const result = serializeExport(event.data.format, event.data.input);
    workerScope.postMessage({ result }, [result.bytes.buffer as ArrayBuffer]);
  } catch (caught) {
    workerScope.postMessage({
      error: caught instanceof Error ? caught.message : 'Falha ao gerar arquivo de exportação.',
    });
  }
};
