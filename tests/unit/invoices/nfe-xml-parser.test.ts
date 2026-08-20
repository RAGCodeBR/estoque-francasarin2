import { describe, expect, it } from 'vitest';

import { NfeXmlError, parseNfeXml, parseNfeXmlFile } from '../../../src/modules/invoices';
import { createNfeXml, VALID_ACCESS_KEY, xmlFile } from '../../fixtures/nfe-xml';

describe('parser seguro de NF-e XML', () => {
  it('extrai cabeçalho, fornecedor e itens sem perder precisão decimal', async () => {
    const result = await parseNfeXmlFile(xmlFile(createNfeXml()));

    expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.invoice).toMatchObject({
      accessKey: VALID_ACCESS_KEY,
      invoiceNumber: '123',
      series: '1',
      issuedAt: '2026-08-20T13:00:00.000Z',
      supplier: {
        document: '11222333000181',
        legalName: 'Fornecedor Teste Ltda',
        tradeName: 'Fornecedor Teste',
      },
    });
    expect(result.invoice.items).toEqual([
      {
        lineNumber: 1,
        supplierProductCode: 'FORN-1',
        description: 'Arroz Integral',
        ean: '7894900011517',
        unit: 'KG',
        quantity: '5.250',
        unitPrice: '10.5000',
        totalAmount: '55.13',
      },
      {
        lineNumber: 2,
        supplierProductCode: 'FORN-2',
        description: 'Feijão',
        ean: null,
        unit: 'UN',
        quantity: '3.000',
        unitPrice: '7.1000',
        totalAmount: '21.30',
      },
    ]);
  });

  it.each([
    ['DOCTYPE', '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NFe/>'],
    ['entidade', '<!ENTITY xxe "unsafe"><NFe/>'],
    ['stylesheet', '<?xml-stylesheet href="https://example.com/x.xsl"?><NFe/>'],
  ])('rejeita XML inseguro com %s', (_label, xml) => {
    expect(() => parseNfeXml(xml)).toThrow(NfeXmlError);
  });

  it('rejeita PDF, arquivo enorme e quantidade que exigiria arredondamento', async () => {
    await expect(parseNfeXmlFile(xmlFile(createNfeXml(), 'nota.pdf'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_DOCUMENT',
    });
    await expect(
      parseNfeXmlFile(xmlFile(createNfeXml()), {
        maxFileBytes: 2,
        maxItems: 10,
        maxTextLength: 100,
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(() =>
      parseNfeXml(createNfeXml().replace('<qCom>5.250</qCom>', '<qCom>5.2501</qCom>')),
    ).toThrow(/NUMERIC/);
    expect(() => parseNfeXml('<NFe><infNFe></NFe>')).toThrow(/bem-formado/);
  });

  it('preserva unidade externa desconhecida para resolução no staging', () => {
    expect(parseNfeXml(createNfeXml({ unit: 'CX' })).items[0]?.unit).toBe('CX');
  });

  it('rejeita chave, CNPJ e linhas duplicadas inválidas', () => {
    expect(() =>
      parseNfeXml(createNfeXml().replace(VALID_ACCESS_KEY, `${VALID_ACCESS_KEY.slice(0, -1)}9`)),
    ).toThrow(/Chave/);
    expect(() =>
      parseNfeXml(
        createNfeXml().replace('<CNPJ>11222333000181</CNPJ>', '<CNPJ>11111111111111</CNPJ>'),
      ),
    ).toThrow(/CNPJ/);
    expect(() => parseNfeXml(createNfeXml().replace('nItem="2"', 'nItem="1"'))).toThrow(
      /duplicados/,
    );
  });
});
