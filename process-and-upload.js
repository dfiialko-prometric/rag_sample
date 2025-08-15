const axios = require('axios');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const BASE_URL = 'https://prochat-function-app-d2gnekb9cadvfmes.canadacentral-01.azurewebsites.net/api';

/**
 * Extract text from different file types
 */
async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    switch (ext) {
      case '.pdf':
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(pdfBuffer);
        return pdfData.text;
        
      case '.docx':
      case '.doc':
        const docBuffer = fs.readFileSync(filePath);
        const docData = await mammoth.extractRawText({ buffer: docBuffer });
        return docData.value;
        
      case '.txt':
        return fs.readFileSync(filePath, 'utf8');
        
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  } catch (error) {
    throw new Error(`Failed to extract text from ${filePath}: ${error.message}`);
  }
}

/**
 * Upload extracted text to Azure Functions
 */
async function uploadTextToAzure(text, filename) {
  const uploadPayload = {
    text: text,
    filename: filename
  };
  
  try {
    // Update this to uploadDocuments for Vector DB usage
    const response = await axios.post(`${BASE_URL}/uploadDocumentsBasic`, uploadPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    throw error;
  }
}

// Update this to searchDocuments for Vector DB usage
async function searchDocuments(query, topK = 5) {
  const response = await axios.get(`${BASE_URL}/searchDocumentsBasic`, {
    params: { q: query, topK: topK }
  });
  
  return response.data;
}

/**
 * Main function to process a file and upload it
 */
async function processFile(filePath) {
  try {
    // Step 1: Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Step 2: Extract text
    const extractedText = await extractTextFromFile(filePath);
    
    if (extractedText.length === 0) {
      throw new Error('No text content found in file');
    }

    // Step 3: Upload to Azure
    const uploadResult = await uploadTextToAzure(extractedText, path.basename(filePath));

    // Step 4: Test search
    const searchResults = await searchDocuments('test', 3);
    
    return uploadResult;

  } catch (error) {
    throw error;
  }
}

// Example usage
if (require.main === module) {
  const filePath = process.argv[2];
  
  if (!filePath) {
    process.exit(1);
  }
  
  processFile(filePath)
    .then(() => {})
    .catch(() => process.exit(1));
}

module.exports = {
  extractTextFromFile,
  uploadTextToAzure,
  searchDocuments,
  processFile
}; 