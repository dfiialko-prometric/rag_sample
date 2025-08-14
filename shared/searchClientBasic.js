const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');

// Cache the client instance
let cachedClient = null;

/**
 * Get Azure AI Search client for basic text search (cached)
 * @returns {SearchClient} - Search client instance
 */
function getSearchClient() {
  // Return cached client if available
  if (cachedClient) {
    return cachedClient;
  }
  
  // Load environment variables at runtime, not import time
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME;
  
  if (!endpoint || !apiKey || !indexName) {
    throw new Error('Azure Search configuration missing. Check AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_API_KEY, and AZURE_SEARCH_INDEX_NAME environment variables.');
  }

  // Create and cache the client
  cachedClient = new SearchClient(
    endpoint,
    indexName,
    new AzureKeyCredential(apiKey)
  );
  
  return cachedClient;
}

/**
 * Store document chunks in Azure AI Search (basic text search only)
 * @param {string} documentId - Unique document identifier
 * @param {string} filename - Original filename
 * @param {string[]} chunks - Text chunks
 * @param {number[][]} embeddings - Embedding vectors (not used in basic mode)
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
    // Note: No contentVector field - using basic text search only
  }));

  try {
    await client.mergeOrUploadDocuments(documents);

  } catch (error) {
    throw new Error(`Failed to store documents in search: ${error.message}`);
  }
}

/**
 * Search documents in Azure AI Search (basic text search)
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
    includeTotalCount: true
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
    return {
      tier: 'Free',
      maxStorage: '50MB',
      maxDocuments: '1000',
      searchType: 'Text search only',
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