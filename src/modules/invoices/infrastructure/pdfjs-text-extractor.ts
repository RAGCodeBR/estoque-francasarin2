import type { PdfImportLimits } from '../config/pdf-limits';
import { PdfImportError } from '../domain/pdf-errors';
import type { PdfTextExtraction, PdfTextLine } from '../domain/pdf-types';
import type { PdfTextExtractor } from '../ports/pdf-text-extractor';

interface PositionedText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

function groupLines(items: readonly PositionedText[], page: number): readonly PdfTextLine[] {
  const rows: PositionedText[][] = [];
  for (const item of [...items].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const row = rows.find((candidate) => Math.abs((candidate[0]?.y ?? item.y) - item.y) <= 2);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => ({
    page,
    text: row
      .sort((left, right) => left.x - right.x)
      .map(({ text }) => text)
      .join(' ')
      .trim(),
  }));
}

export class PdfJsTextExtractor implements PdfTextExtractor {
  async extract(bytes: Uint8Array, limits: PdfImportLimits): Promise<PdfTextExtraction> {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const copied = new Uint8Array(bytes.byteLength);
      copied.set(bytes);
      const task = pdfjs.getDocument({
        data: copied,
        isEvalSupported: false,
        useWorkerFetch: false,
        disableFontFace: true,
        stopAtErrors: true,
      });
      const document = await task.promise;
      if (document.numPages > limits.maxPages) {
        await document.destroy();
        throw new PdfImportError('PAGE_LIMIT_EXCEEDED', 'O PDF excede o limite de páginas.', {
          maxPages: limits.maxPages,
        });
      }
      const lines: PdfTextLine[] = [];
      let characterCount = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent({ disableNormalization: false });
        const positioned: PositionedText[] = [];
        for (const item of content.items) {
          if (!('str' in item) || item.str.trim() === '') continue;
          const transform: unknown = item.transform;
          if (!Array.isArray(transform)) continue;
          const x: unknown = transform[4];
          const y: unknown = transform[5];
          if (typeof x !== 'number' || typeof y !== 'number') continue;
          positioned.push({ text: item.str, x, y });
          characterCount += item.str.length;
          if (characterCount > limits.maxExtractedCharacters) {
            await document.destroy();
            throw new PdfImportError(
              'TEXT_LIMIT_EXCEEDED',
              'O texto extraído excede o limite configurado.',
              { maxExtractedCharacters: limits.maxExtractedCharacters },
            );
          }
        }
        lines.push(...groupLines(positioned, pageNumber));
        page.cleanup();
      }
      await document.destroy();
      return { pageCount: document.numPages, lines, characterCount };
    } catch (error) {
      if (error instanceof PdfImportError) throw error;
      const message = error instanceof Error ? error.message : 'unknown';
      if (/password/i.test(message))
        throw new PdfImportError(
          'PASSWORD_PROTECTED',
          'PDF protegido por senha não pode ser importado.',
        );
      throw new PdfImportError('INVALID_PDF', 'Não foi possível ler o arquivo PDF.', {
        cause: message,
      });
    }
  }
}
