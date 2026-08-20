import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';

import { calculateSha256 } from '../../data-import/infrastructure/file-hash';
import { isValidCnpj } from '../../../utils/cnpj';
import { isValidGtin } from '../../../utils/gtin';
import { isValidNfeAccessKey } from '../../../utils/nfe-access-key';
import type { NfeXmlLimits } from '../config/nfe-limits';
import { DEFAULT_NFE_XML_LIMITS } from '../config/nfe-limits';
import { NfeXmlError } from '../domain/errors';
import type { NfeItem, NfeXmlFile, ParsedNfe, ParsedNfeFile } from '../domain/types';

type UnknownRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  allowBooleanAttributes: false,
});

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NfeXmlError('INVALID_NFE', `Estrutura obrigatória ausente: ${label}.`);
  }
  return value as UnknownRecord;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function text(value: unknown, label: string, required = true): string | null {
  const result = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!result && required) throw new NfeXmlError('INVALID_NFE', `${label} é obrigatório.`);
  return result || null;
}

function digits(value: unknown, label: string, required = false): string | null {
  const valueText = text(value, label, required);
  if (valueText === null) return null;
  if (!/^\d+$/.test(valueText))
    throw new NfeXmlError('INVALID_NFE', `${label} deve conter apenas dígitos.`);
  return valueText;
}

function exactDecimal(value: unknown, label: string, scale: number): string {
  const valueText = text(value, label) ?? '';
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,14})(?:\\.\\d{1,${String(scale)}})?$`);
  if (!pattern.test(valueText)) {
    throw new NfeXmlError(
      'INVALID_NFE',
      `${label} deve ser não negativo e caber em NUMERIC com ${String(scale)} casas decimais.`,
      { value: valueText },
    );
  }
  const [integer = '0', fraction = ''] = valueText.split('.');
  return `${integer}.${fraction.padEnd(scale, '0')}`;
}

function decodeXml(bytes: Uint8Array): string {
  const declaration = new TextDecoder('ascii').decode(
    bytes.subarray(0, Math.min(bytes.length, 200)),
  );
  const encoding = /encoding=["']([^"']+)["']/i.exec(declaration)?.[1]?.toLowerCase();
  if (
    encoding !== undefined &&
    !['utf-8', 'utf8', 'iso-8859-1', 'iso8859-1', 'latin1'].includes(encoding)
  ) {
    throw new NfeXmlError('INVALID_ENCODING', `Encoding XML não suportado: ${encoding}.`);
  }
  const decoderEncoding = encoding?.includes('8859-1') ? 'windows-1252' : 'utf-8';
  try {
    const xml = new TextDecoder(decoderEncoding, { fatal: true }).decode(bytes);
    if (xml.includes('\0')) throw new Error('NUL byte');
    return xml.replace(/^\uFEFF/, '');
  } catch {
    throw new NfeXmlError(
      'INVALID_ENCODING',
      'O XML não possui encoding UTF-8 ou ISO-8859-1 válido.',
    );
  }
}

function parseItem(value: unknown, fallbackLine: number, limits: NfeXmlLimits): NfeItem {
  const detail = record(value, 'det');
  const product = record(detail.prod, 'det/prod');
  const lineText = text(detail['@_nItem'], 'Número do item', false);
  const lineNumber = lineText ? Number(lineText) : fallbackLine;
  const description = text(product.xProd, 'Descrição do item') ?? '';
  if (
    !Number.isSafeInteger(lineNumber) ||
    lineNumber <= 0 ||
    description.length > limits.maxTextLength
  ) {
    throw new NfeXmlError('INVALID_NFE', 'Número ou descrição do item inválido.');
  }
  const eanValue = text(product.cEANTrib ?? product.cEAN, 'EAN', false);
  const ean =
    eanValue && !['SEM GTIN', 'SEMGTIN'].includes(eanValue.toUpperCase())
      ? digits(eanValue, 'EAN')
      : null;
  if (ean && !isValidGtin(ean)) throw new NfeXmlError('INVALID_NFE', 'EAN inválido.');
  return {
    lineNumber,
    supplierProductCode: text(product.cProd, 'Código do produto do fornecedor', false),
    description,
    ean,
    unit: text(product.uCom ?? product.uTrib, 'Unidade') ?? '',
    quantity: exactDecimal(product.qCom ?? product.qTrib, 'Quantidade', 3),
    unitPrice: exactDecimal(product.vUnCom ?? product.vUnTrib, 'Valor unitário', 4),
    totalAmount: exactDecimal(product.vProd, 'Valor total', 2),
  };
}

export function parseNfeXml(xml: string, limits: NfeXmlLimits = DEFAULT_NFE_XML_LIMITS): ParsedNfe {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) {
    throw new NfeXmlError('UNSAFE_XML', 'DOCTYPE, entidades e folhas de estilo não são aceitos.');
  }
  try {
    SyntaxValidator.validate(xml, { allowBooleanAttributes: false });
  } catch (error) {
    throw new NfeXmlError('INVALID_XML', 'O arquivo não contém XML bem-formado.', {
      problem: error instanceof Error ? error.message : 'unknown',
    });
  }
  let document: UnknownRecord;
  try {
    document = record(parser.parse(xml) as unknown, 'documento XML');
  } catch (error) {
    if (error instanceof NfeXmlError) throw error;
    throw new NfeXmlError('INVALID_XML', 'O arquivo não contém XML bem-formado.');
  }
  const root = record(document.nfeProc ?? document.NFe ?? document.procNFe, 'nfeProc/NFe');
  const nfe = document.NFe ? root : record(root.NFe, 'NFe');
  const infNfe = record(nfe.infNFe, 'infNFe');
  const identifier = text(infNfe['@_Id'], 'ID da NF-e', false);
  const identifierKey = identifier?.startsWith('NFe') ? identifier.slice(3) : null;
  const protocol = document.NFe ? null : record(root.protNFe ?? {}, 'protNFe');
  const protocolInfo =
    protocol && Object.keys(protocol).length > 0 ? record(protocol.infProt, 'infProt') : null;
  const protocolKey = protocolInfo ? digits(protocolInfo.chNFe, 'Chave do protocolo', false) : null;
  if (identifierKey && protocolKey && identifierKey !== protocolKey) {
    throw new NfeXmlError('INVALID_NFE', 'A chave do protocolo difere da chave da NF-e.');
  }
  const accessKey = identifierKey ?? protocolKey;
  if (accessKey && !isValidNfeAccessKey(accessKey))
    throw new NfeXmlError('INVALID_NFE', 'Chave de acesso da NF-e inválida.');
  const header = record(infNfe.ide, 'ide');
  const issuer = record(infNfe.emit, 'emit');
  const supplierDocument = digits(issuer.CNPJ, 'CNPJ do fornecedor', true) ?? '';
  if (!isValidCnpj(supplierDocument))
    throw new NfeXmlError('INVALID_NFE', 'CNPJ do fornecedor inválido.');
  const issuedAt = text(header.dhEmi ?? header.dEmi, 'Data de emissão') ?? '';
  if (Number.isNaN(Date.parse(issuedAt)))
    throw new NfeXmlError('INVALID_NFE', 'Data de emissão inválida.');
  const details = array(infNfe.det);
  if (details.length === 0 || details.length > limits.maxItems) {
    throw new NfeXmlError('INVALID_NFE', 'Quantidade de itens da NF-e inválida.', {
      maxItems: limits.maxItems,
    });
  }
  const items = details.map((item, index) => parseItem(item, index + 1, limits));
  if (new Set(items.map(({ lineNumber }) => lineNumber)).size !== items.length) {
    throw new NfeXmlError('INVALID_NFE', 'A NF-e possui números de item duplicados.');
  }
  return {
    accessKey,
    invoiceNumber: text(header.nNF, 'Número da NF-e') ?? '',
    series: text(header.serie, 'Série', false),
    issuedAt: new Date(issuedAt).toISOString(),
    supplier: {
      document: supplierDocument,
      legalName: text(issuer.xNome, 'Razão social do fornecedor') ?? '',
      tradeName: text(issuer.xFant, 'Nome fantasia', false),
    },
    items,
  };
}

export async function parseNfeXmlFile(
  file: NfeXmlFile,
  limits: NfeXmlLimits = DEFAULT_NFE_XML_LIMITS,
): Promise<ParsedNfeFile> {
  if (file.size <= 0 || file.size > limits.maxFileBytes) {
    throw new NfeXmlError('FILE_TOO_LARGE', 'O XML está vazio ou excede o limite configurado.', {
      maxFileBytes: limits.maxFileBytes,
    });
  }
  if (!file.name.toLowerCase().endsWith('.xml'))
    throw new NfeXmlError('UNSUPPORTED_DOCUMENT', 'Somente arquivos XML são aceitos.');
  if (file.name.normalize('NFKC').trim().length > 255)
    throw new NfeXmlError('INVALID_XML', 'O nome do arquivo XML excede 255 caracteres.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size)
    throw new NfeXmlError('INVALID_XML', 'O tamanho lido não corresponde ao arquivo informado.');
  return {
    fileHash: await calculateSha256(bytes),
    originalFilename: file.name.normalize('NFKC').trim(),
    invoice: parseNfeXml(decodeXml(bytes), limits),
  };
}
