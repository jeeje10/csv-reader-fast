// Fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01).
//
// Same answers as the reference, faster: instead of walking the text one
// character at a time, it jumps between delimiters with indexOf / a shared
// delimiter regex and cuts fields out with slice. The rare broken-row cases
// (stray CRs, doubled quotes, unterminated quotes, junk after a closing
// quote, embedded newlines) fall back to short loops that follow the
// reference's policy exactly.
//
// Policy (from the reference): BOM dropped; records end at LF or CRLF;
// empty lines are no records; a lone CR outside quotes is dropped
// (stray_cr); a quoted field runs to the next undoubled quote, "" inside is
// one quote, CRLF/lone CR inside is read as LF; junk after the closing
// quote is appended as it stands (quote_junk); a quote that never closes is
// a literal character and the rest is re-read as unquoted
// (unterminated_quote); a quote inside an unquoted field is literal; fields
// stay strings; rows are padded (short_row) or cut (long_row) to the first
// record's width; errors are {code, line, row} in the order met, line the
// 1-based line the record starts on, row its index in rows (null: header).

const COMMA = 44; // ','
const LF = 10; // '\n'
const CR = 13; // '\r'
const QUOTE = 34; // '"'

// How a field ended: 0 = comma (record goes on), 1 = line break, 2 = end.
const END_COMMA = 0;
const END_BREAK = 1;
const END_TEXT = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // Delimiter scanner for unquoted reads: next ',' or line break at/after pos.
  const delim = /[,\n\r]/g;

  // Reads an unquoted field starting at `start`, appending onto `base`
  // ('' for a fresh field, '"' for an unterminated quote's re-read, or a
  // quoted field's value for junk). Returns [value, ended, added]: added
  // counts the characters kept (junk's quote_junk needs it).
  function readUnquoted(base, start) {
    let value = base;
    let added = 0;
    let p = start;
    for (;;) {
      delim.lastIndex = p;
      const m = delim.exec(text);
      if (m === null) {
        const tail = text.slice(p);
        value += tail;
        added += tail.length;
        pos = n;
        return [value, END_TEXT, added];
      }
      const d = m.index;
      const ch = m[0];
      if (ch === ',') {
        value += text.slice(p, d);
        added += d - p;
        pos = d + 1;
        return [value, END_COMMA, added];
      }
      if (ch === '\n') {
        value += text.slice(p, d);
        added += d - p;
        pos = d + 1;
        line += 1;
        return [value, END_BREAK, added];
      }
      // '\r': CRLF ends the field, a lone CR is dropped (stray_cr).
      if (text.charCodeAt(d + 1) === LF) {
        value += text.slice(p, d);
        added += d - p;
        pos = d + 2;
        line += 1;
        return [value, END_BREAK, added];
      }
      value += text.slice(p, d);
      added += d - p;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      p = d + 1;
    }
  }

  // Counts the line breaks in a quoted field's raw content (CRLF and lone
  // CR each one, like LF) and normalizes every CR form to LF.
  function normalizeQuoted(content) {
    if (!/[\r\n]/.test(content)) return content;
    if (content.indexOf('\r') === -1) {
      line += content.split('\n').length - 1;
      return content;
    }
    const breaks = content.match(/\r\n|[\r\n]/g);
    line += breaks ? breaks.length : 0;
    return content.replace(/\r\n?/g, '\n');
  }

  // The record being read: the line it starts on and its index in rows
  // (null: the header). Declared here so readUnquoted's stray_cr errors
  // use the current record, as the reference does.
  let recordLine = 1;
  let recordRow = null;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quotes and no stray CRs is one split.
    // The span runs to the next LF (or the end of the text); a CR right
    // before that LF is the CRLF ending, not a stray CR. A quote or a CR
    // anywhere else in the span falls back to the field parser below.
    const nl = text.indexOf('\n', pos);
    const recEnd = nl === -1 ? n : nl;
    let spanEnd = recEnd;
    if (nl !== -1 && spanEnd > pos && text.charCodeAt(spanEnd - 1) === CR) spanEnd -= 1;
    const span = text.slice(pos, spanEnd);
    if (span.indexOf('"') === -1 && span.indexOf('\r') === -1) {
      const fields = span.split(',');
      if (!(fields.length === 1 && fields[0] === '')) {
        if (width < 0) width = fields.length;
        if (header && columns === null) {
          columns = fields;
        } else {
          if (fields.length < width) {
            errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
            while (fields.length < width) fields.push('');
          } else if (fields.length > width) {
            errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
          }
          rows.push(fields);
        }
      }
      if (nl === -1) {
        pos = n;
        break;
      }
      pos = nl + 1;
      line += 1;
      continue;
    }

    const fields = [];
    let quoted = false;
    let ended = END_COMMA;

    do {
      if (text.charCodeAt(pos) === QUOTE) {
        quoted = true;
        const open = pos;
        const openLine = line;
        let j = text.indexOf('"', pos + 1);
        if (j === -1) {
          // Never closes: literal quote, re-read as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          const r = readUnquoted('"', pos);
          fields.push(r[0]);
          ended = r[1];
          continue;
        }
        let value;
        let close;
        if (text.charCodeAt(j + 1) === QUOTE) {
          // Doubled quotes: accumulate segments until the real close.
          value = text.slice(pos + 1, j) + '"';
          let scan = j + 2;
          close = -1;
          while (scan < n) {
            const k = text.indexOf('"', scan);
            if (k === -1) break;
            if (text.charCodeAt(k + 1) === QUOTE) {
              value += text.slice(scan, k) + '"';
              scan = k + 2;
            } else {
              value += text.slice(scan, k);
              close = k;
              break;
            }
          }
          if (close === -1) {
            // A doubled quote, then never closes: same as unterminated.
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pos = open + 1;
            line = openLine;
            const r = readUnquoted('"', pos);
            fields.push(r[0]);
            ended = r[1];
            continue;
          }
        } else {
          value = text.slice(pos + 1, j);
          close = j;
        }
        value = normalizeQuoted(value);
        const after = close + 1;
        if (after >= n) {
          fields.push(value);
          pos = n;
          ended = END_TEXT;
          continue;
        }
        const c = text.charCodeAt(after);
        if (c === COMMA) {
          fields.push(value);
          pos = after + 1;
          ended = END_COMMA;
        } else if (c === LF) {
          fields.push(value);
          pos = after + 1;
          line += 1;
          ended = END_BREAK;
        } else if (c === CR && text.charCodeAt(after + 1) === LF) {
          fields.push(value);
          pos = after + 2;
          line += 1;
          ended = END_BREAK;
        } else {
          // Junk after the closing quote, appended as it stands.
          const r = readUnquoted(value, after);
          if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          fields.push(r[0]);
          ended = r[1];
        }
      } else {
        quoted = false;
        // Fast path: one delimiter scan, no stray CR in the way.
        delim.lastIndex = pos;
        const m = delim.exec(text);
        if (m === null) {
          fields.push(text.slice(pos));
          pos = n;
          ended = END_TEXT;
        } else {
          const d = m.index;
          const ch = m[0];
          if (ch === ',') {
            fields.push(text.slice(pos, d));
            pos = d + 1;
            ended = END_COMMA;
          } else if (ch === '\n') {
            fields.push(text.slice(pos, d));
            pos = d + 1;
            line += 1;
            ended = END_BREAK;
          } else if (text.charCodeAt(d + 1) === LF) {
            fields.push(text.slice(pos, d));
            pos = d + 2;
            line += 1;
            ended = END_BREAK;
          } else {
            // Lone CR: fall back to the accumulating reader.
            const r = readUnquoted('', pos);
            fields.push(r[0]);
            ended = r[1];
          }
        }
      }
    } while (ended === END_COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
