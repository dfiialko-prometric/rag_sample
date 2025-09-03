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
        throw new Error('PDF parsing from content not implemented yet');
      case '.docx':
      case '.doc':
        throw new Error('Word document parsing from content not implemented yet');
      case '.txt':
      case '':
        return { text: content, type: 'text/plain' };
      default:
        return { text: content, type: 'text/plain' };
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

module.exports = { parseDocument, parseDocumentContent }; 