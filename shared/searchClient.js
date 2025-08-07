const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
require('dotenv').config();

/**
 * Get Azure AI Search client
 * @returns {SearchClient} - Search client instance
 */
function getSearchClient() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

  if (!endpoint || !apiKey || !indexName) {
    throw new Error('Azure Search configuration missing. Check AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_API_KEY, and AZURE_SEARCH_INDEX_NAME environment variables.');
  }

  return new SearchClient(
    endpoint,
    indexName,
    new AzureKeyCredential(apiKey)
  );
}

/**
 * Store document chunks in Azure AI Search
 * @param {string} documentId - Unique document identifier
 * @param {string} filename - Original filename
 * @param {string[]} chunks - Text chunks
 * @param {number[][]} embeddings - Embedding vectors
 * @returns {Promise<void>}
 */
async function storeInSearch(documentId, filename, chunks, embeddings) {
  const client = getSearchClient();
  
  const documents = chunks.map((chunk, index) => ({
    id: `${documentId}-${index}`,
    documentId: documentId,
    filename: filename,
    chunkIndex: index,
    content: chunk,
    chunkSize: chunk.length,
    uploadDate: new Date().toISOString(),
    fileType: filename.split('.').pop().toLowerCase(),
    hasContent: chunk.length > 0
    // Note: contentVector field removed for Free tier compatibility
  }));

  try {
    await client.uploadDocuments(documents);
    console.log(`Stored ${documents.length} chunks for ${filename}`);
  } catch (error) {
    throw new Error(`Failed to store documents in search: ${error.message}`);
  }
}

/**
 * Search documents in Azure AI Search
 * @param {string} query - Search query
 * @param {number} topK - Number of results to return
 * @param {Object} filters - Search filters
 * @returns {Promise<Array>} - Search results
 */
async function searchDocuments(query, topK = 5, filters = {}) {
  const client = getSearchClient();
  
  const searchOptions = {
    top: topK,
    select: ['id', 'documentId', 'filename', 'chunkIndex', 'content', 'chunkSize', 'uploadDate'],
    orderBy: ['@search.score desc']
  };

  try {
    const searchResults = await client.search(query, searchOptions);
    const results = [];
    
    for await (const result of searchResults.results) {
      results.push({
        score: result.score,
        document: result.document
      });
    }
    
    return results;
  } catch (error) {
    throw new Error(`Failed to search documents: ${error.message}`);
  }
}

/**
 * Get index statistics
 * @returns {Promise<Object>} - Index statistics
 */
async function getIndexStats() {
  try {
    // For Free tier, we'll return basic info since some APIs may not be available
    return {
      tier: 'Free',
      maxStorage: '50MB',
      maxDocuments: '1000',
      note: 'Vector search not available on Free tier'
    };
  } catch (error) {
    throw new Error(`Failed to get index stats: ${error.message}`);
  }
}

module.exports = { 
  storeInSearch, 
  searchDocuments, 
  getIndexStats, 
  getSearchClient 
}; 