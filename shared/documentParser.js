const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

async function parseDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    switch (ext) {
      case '.pdf':
        return { text: await parsePDF(filePath), type: 'application/pdf' };
      case '.docx':
      case '.doc':
        return { text: await parseWord(filePath), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      case '.txt':
        return { text: await parseText(filePath), type: 'text/plain' };
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  } catch (error) {
    throw new Error(`Failed to parse document: ${error.message}`);
  }
}

async function parseDocumentContent(content, filename) {
  const ext = path.extname(filename).toLowerCase();
  
  try {
    switch (ext) {
      case '.pdf':
        return { text: await parsePDFFromBuffer(content), type: 'application/pdf' };
      case '.docx':
      case '.doc':
        return { text: await parseWordFromBuffer(content), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      case '.txt':
      case '':
        return { text: content.toString(), type: 'text/plain' };
      default:
        return { text: content.toString(), type: 'text/plain' };
    }
  } catch (error) {
    throw new Error(`Failed to parse document: ${error.message}`);
  }
}

async function parsePDF(filePath) {
  const dataBuffer = await fs.readFile(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

async function parseWord(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function parseText(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return data;
}

async function parsePDFFromBuffer(buffer) {
  try {
    // Convert string back to buffer if needed
    const actualBuffer = typeof buffer === 'string' ? Buffer.from(buffer, 'utf-8') : buffer;
    const data = await pdfParse(actualBuffer);
    return data.text;
  } catch (error) {
    throw error;
  }
}

async function parseWordFromBuffer(buffer) {
  const result = await mammoth.extractRawText({ buffer: buffer });
  return result.value;
}

module.exports = { parseDocument, parseDocumentContent }; 