const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Parse a document file and extract plain text content
 * @param {string} filePath - Path to the document file
 * @returns {Promise<string>} - Extracted text content
 */
async function parseDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    switch (ext) {
      case '.pdf':
        return await parsePDF(filePath);
      case '.docx':
      case '.doc':
        return await parseWord(filePath);
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  } catch (error) {
    throw new Error(`Failed to parse document: ${error.message}`);
  }
}

/**
 * Parse PDF document
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} - Extracted text
 */
async function parsePDF(filePath) {
  const dataBuffer = await fs.readFile(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

/**
 * Parse Word document
 * @param {string} filePath - Path to Word file
 * @returns {Promise<string>} - Extracted text
 */
async function parseWord(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

module.exports = { parseDocument }; 