const axios = require('axios');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const BASE_URL = 'https://prochat-function-app-d2gnekb9cadvfmes.canadacentral-01.azurewebsites.net/api';

/**
 * Extract text from different file types
 */
async function extractTextFromFile(filePath, originalFilename = null) {
  // Use original filename for extension detection if available, otherwise use filePath
  const filename = originalFilename || filePath;
  const ext = path.extname(filename).toLowerCase();
  
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
  
  console.log(`Sending payload to Azure: ${JSON.stringify(uploadPayload, null, 2)}`);
  
  try {
    // Update this to uploadDocuments for Vector DB usage
    const response = await axios.post(`${BASE_URL}/uploadDocumentsBasic`, uploadPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Azure response status: ${response.status}`);
    console.log(`Azure response data: ${JSON.stringify(response.data, null, 2)}`);
    
    // Add chunk count to response for web UI
    const result = response.data;
    if (result.success && result.chunksProcessed) {
      return result;
    } else {
      // Estimate chunks based on text length (rough estimate)
      const estimatedChunks = Math.ceil(text.length / 1000); // Assuming 1000 chars per chunk
      return {
        ...result,
        chunksProcessed: estimatedChunks
      };
    }
  } catch (error) {
    console.error(`Azure upload error: ${error.message}`);
    if (error.response) {
      console.error(`Azure error response: ${JSON.stringify(error.response.data, null, 2)}`);
      
      // Check if it's the "No indexing actions" error for short text
      if (error.response.data && error.response.data.error && 
          error.response.data.error.includes('No indexing actions found') && 
          text.length < 100) {
        
        console.log('Detected short text issue, using local processing fallback...');
        
        // Use local chunking and upload directly to Azure Search
        const { chunkText } = require('./shared/chunker');
        const { storeInSearch } = require('./shared/searchClientBasic');
        
        const chunks = await chunkText(text);
        console.log(`Local chunking created ${chunks.length} chunks`);
        
        if (chunks.length > 0) {
          const documentId = require('uuid').v4();
          await storeInSearch(documentId, filename, chunks, []);
          
          return {
            success: true,
            documentId: documentId,
            filename: filename,
            chunksProcessed: chunks.length,
            message: 'Text processed locally and uploaded to Azure Search'
          };
        }
      }
    }
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
async function processFile(filePath, originalFilename = null) {
  try {
    // Step 1: Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Step 2: Extract text using original filename for type detection
    const extractedText = await extractTextFromFile(filePath, originalFilename);
    
    console.log(`Extracted text length: ${extractedText.length}`);
    console.log(`Text preview: ${extractedText.substring(0, 100)}...`);
    
    if (extractedText.length === 0) {
      throw new Error('No text content found in file');
    }

    // Step 3: Upload to Azure using original filename
    const filename = originalFilename || path.basename(filePath);
    console.log(`Uploading to Azure with filename: ${filename}`);
    const uploadResult = await uploadTextToAzure(extractedText, filename);

    // Step 4: Test search
    const searchResults = await searchDocuments('test', 3);
    
    // Return result with chunk count for web UI
    return {
      ...uploadResult,
      chunksProcessed: uploadResult.chunksProcessed || 1
    };

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