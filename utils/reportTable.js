/**
 * Draws a school's custom report-card results table into a PDFKit doc.
 * Only used when a student's records were saved under a custom template;
 * schools on the built-in layout keep the original hard-coded tables.
 *
 * layout = result of assessment.buildReportLayout():
 *   { columns:[{key,label,type,max,source}], rows:[{subject_name, cells:{key:value}}] }
 *
 * Returns the Y position just below the table.
 */

function fmt(v) {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  return String(v);
}

// Trim text with "..." until it fits the cell (PDFKit won't clip for us).
function fit(doc, text, maxWidth) {
  let t = String(text);
  if (doc.widthOfString(t) <= maxWidth) return t;
  while (t.length > 1 && doc.widthOfString(t + '...') > maxWidth) t = t.slice(0, -1);
  return t + '...';
}

function columnWidths(columns, totalWidth) {
  const subjectW = Math.min(Math.max(totalWidth * 0.26, 80), 150);
  const rest = totalWidth - subjectW;
  const weights = columns.map((c) => {
    if (c.type === 'text') return 2.4;
    if (c.type === 'computed' && c.source === 'remark') return 2;
    return 1;
  });
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return { subjectW, widths: weights.map((w) => (rest * w) / sum) };
}

function drawCustomResultsTable(doc, opts) {
  const {
    x, y, width, layout, themeColor = '#2563EB',
    rowHeight = 18, fontSize = 9, headerFontSize = 8,
    bottomMargin = 60, newPageTop = 50,
  } = opts;

  const columns = layout.columns;
  const { subjectW, widths } = columnWidths(columns, width);
  const hasMax = columns.some((c) => c.type === 'number' && c.max);
  const headerH = hasMax ? 30 : 22;
  let cy = y;

  const header = () => {
    doc.fillColor(themeColor).rect(x, cy, width, headerH).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(headerFontSize);
    doc.text('SUBJECT', x + 6, cy + (hasMax ? 11 : 7), { width: subjectW - 8, lineBreak: false });
    let cx = x + subjectW;
    columns.forEach((c, i) => {
      const w = widths[i];
      const raw = String(c.label).toUpperCase();
      // Shrink the heading to fit before resorting to "..."
      let hs = headerFontSize;
      doc.font('Helvetica-Bold').fontSize(hs);
      while (hs > 5.5 && doc.widthOfString(raw) > w - 4) { hs -= 0.5; doc.fontSize(hs); }
      const label = fit(doc, raw, w - 4);
      doc.text(label, cx + 2, cy + (hasMax ? 6 : 7), { width: w - 4, align: 'center', lineBreak: false });
      if (c.type === 'number' && c.max) {
        doc.font('Helvetica').fontSize(headerFontSize - 1);
        doc.text(`/${fmt(c.max)}`, cx + 2, cy + 17, { width: w - 4, align: 'center', lineBreak: false });
      }
      cx += w;
    });
    cy += headerH;
  };

  header();
  doc.font('Helvetica').fontSize(fontSize);

  layout.rows.forEach((row, idx) => {
    if (cy + rowHeight > doc.page.height - bottomMargin) {
      doc.addPage();
      cy = newPageTop;
      header();
      doc.font('Helvetica').fontSize(fontSize);
    }
    doc.fillColor(idx % 2 === 0 ? '#ffffff' : '#f5f5f5').rect(x, cy, width, rowHeight).fill();
    doc.fillColor('#222222').font('Helvetica').fontSize(fontSize);
    doc.text(fit(doc, row.subject_name || '-', subjectW - 10), x + 6, cy + 5, { width: subjectW - 8, lineBreak: false });

    let cx = x + subjectW;
    columns.forEach((c, i) => {
      const w = widths[i];
      const val = row.cells[c.key];
      const isText = c.type === 'text' || (c.type === 'computed' && c.source === 'remark');
      const isTotal = c.type === 'computed' && c.source === 'total';
      doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      doc.fillColor('#222222');
      doc.text(fit(doc, fmt(val), w - 6), cx + 3, cy + 5, {
        width: w - 6, align: isText ? 'left' : 'center', lineBreak: false,
      });
      cx += w;
    });
    doc.strokeColor('#dddddd').lineWidth(0.5).moveTo(x, cy + rowHeight).lineTo(x + width, cy + rowHeight).stroke();
    cy += rowHeight;
  });

  doc.strokeColor(themeColor).lineWidth(1).rect(x, y, width, cy - y).stroke();
  doc.fillColor('#000000').font('Helvetica');
  return cy;
}

module.exports = { drawCustomResultsTable };
