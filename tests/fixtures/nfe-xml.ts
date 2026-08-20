export function createAccessKey(prefix: string): string {
  if (!/^\d{43}$/.test(prefix)) throw new Error('NF-e key prefix must contain 43 digits');
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(prefix[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return `${prefix}${String(remainder === 0 || remainder === 1 ? 0 : 11 - remainder)}`;
}

export const VALID_ACCESS_KEY = createAccessKey('3526081122233300018155001000000123112345678');

export function createNfeXml(
  options: { readonly extraRoot?: string; readonly unit?: string } = {},
): string {
  const unit = options.unit ?? 'KG';
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe${VALID_ACCESS_KEY}" versao="4.00">
    <ide><serie>1</serie><nNF>123</nNF><dhEmi>2026-08-20T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>11222333000181</CNPJ><xNome>Fornecedor Teste Ltda</xNome><xFant>Fornecedor Teste</xFant></emit>
    <det nItem="1"><prod><cProd>FORN-1</cProd><cEAN>7894900011517</cEAN><xProd>Arroz Integral</xProd><uCom>${unit}</uCom><qCom>5.250</qCom><vUnCom>10.5000</vUnCom><vProd>55.13</vProd></prod></det>
    <det nItem="2"><prod><cProd>FORN-2</cProd><cEAN>SEM GTIN</cEAN><xProd>Feijão</xProd><uCom>UN</uCom><qCom>3</qCom><vUnCom>7.1000</vUnCom><vProd>21.30</vProd></prod></det>
  </infNFe></NFe>${options.extraRoot ?? ''}
</nfeProc>`;
}

export function xmlFile(xml: string, name = 'nota.xml') {
  const bytes = new TextEncoder().encode(xml);
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}
