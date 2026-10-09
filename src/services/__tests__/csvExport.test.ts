import { escapeCsvField, guardFormula } from '../csvExport';

describe('escapeCsvField', () => {
  it('leaves a plain string untouched', () => {
    expect(escapeCsvField('Chicken bowl')).toBe('Chicken bowl');
  });

  it('keeps umlauts intact and unquoted', () => {
    expect(escapeCsvField('Zürcher Geschnetzeltes')).toBe('Zürcher Geschnetzeltes');
  });

  it('quotes a field with a comma', () => {
    expect(escapeCsvField('rice, beans')).toBe('"rice, beans"');
  });

  it('quotes a field with a double quote and doubles the quote', () => {
    expect(escapeCsvField('a"b')).toBe('"a""b"');
  });

  it('quotes a field with a line feed', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('quotes a field with a carriage return in the middle', () => {
    expect(escapeCsvField('line1\rline2')).toBe('"line1\rline2"');
  });

  it('quotes a field with CRLF inside', () => {
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('does not quote leading or trailing spaces', () => {
    expect(escapeCsvField(' padded ')).toBe(' padded ');
  });

  it('writes an empty string as empty', () => {
    expect(escapeCsvField('')).toBe('');
  });

  it('writes null and undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('writes finite numbers as plain numbers, negatives untouched', () => {
    expect(escapeCsvField(72.5)).toBe('72.5');
    expect(escapeCsvField(0)).toBe('0');
    expect(escapeCsvField(-5.5)).toBe('-5.5');
  });

  it('writes non-finite numbers as empty', () => {
    expect(escapeCsvField(NaN)).toBe('');
    expect(escapeCsvField(Infinity)).toBe('');
    expect(escapeCsvField(-Infinity)).toBe('');
  });

  it('writes booleans as 1 or 0', () => {
    expect(escapeCsvField(true)).toBe('1');
    expect(escapeCsvField(false)).toBe('0');
  });

  it('guards a formula-looking string and does not quote it for that', () => {
    expect(escapeCsvField('=SUM(A1)')).toBe("'=SUM(A1)");
  });

  it('applies the guard before quoting', () => {
    expect(escapeCsvField('=A1,B1')).toBe('"\'=A1,B1"');
  });
});

describe('guardFormula', () => {
  it.each(['=SUM(A1)', '+1', '-5 min bowl', '@cmd', '\tx', '\rx'])(
    'prefixes %j with an apostrophe',
    (text) => {
      expect(guardFormula(text)).toBe(`'${text}`);
    }
  );

  it.each(['Chicken', '5 min bowl', '', 'a=b', ' =x', "'=x", 'Zürcher'])(
    'leaves %j alone',
    (text) => {
      expect(guardFormula(text)).toBe(text);
    }
  );
});
