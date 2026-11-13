'use strict';

const fs = require('fs');

const EXPORT_FORMATS = new Set(['txt', 'md']);

function formatItalianDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('it-IT');
}

function buildExportContent({ format = 'txt', name, date, text } = {}) {
  const safeFormat = EXPORT_FORMATS.has(format) ? format : 'txt';
  const body = String(text ?? '');
  if (safeFormat !== 'md') return body;

  const title = String(name || 'Trascrizione');
  const day = formatItalianDate(date) || 'N/A';
  return `# ${title}\n\n_Registrato il ${day}_\n\n---\n\n${body}`;
}

function exportFilename({ format = 'txt', name } = {}) {
  const safeFormat = EXPORT_FORMATS.has(format) ? format : 'txt';
  return `${String(name || 'trascrizione')}.${safeFormat}`;
}

function writeExportFile({ filePath, format, name, date, text, writeFile = fs.writeFileSync }) {
  const content = buildExportContent({ format, name, date, text });
  writeFile(filePath, content, 'utf8');
  return { success: true, filePath, content };
}

module.exports = {
  EXPORT_FORMATS,
  buildExportContent,
  exportFilename,
  formatItalianDate,
  writeExportFile,
};
