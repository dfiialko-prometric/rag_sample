const { SearchClient, SearchIndexClient, AzureKeyCredential } = require('@azure/search-documents');
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

// Store document chunks with embeddings in search index
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
    hasContent: chunk.length > 0,
    vector: embeddings[index] || new Array(1536).fill(0) // Include vector embeddings
  }));

  try {
    await client.uploadDocuments(documents);
    console.log(`✅ Stored ${documents.length} document chunks with vector embeddings`);

  } catch (error) {
    throw new Error(`Failed to store documents in search: ${error.message}`);
  }
}

// Search documents with optional vector search
async function searchDocuments(query, topK = 5, filters = {}, queryEmbedding = null) {
  const client = getSearchClient();
  
  const searchOptions = {
    top: topK,
    select: ['id', 'documentId', 'filename', 'chunkIndex', 'content', 'chunkSize', 'uploadDate', 'fileType'],
    searchFields: ['content^3', 'filename^2'], // Boost content 3x, filename 2x
    queryType: 'simple',
    searchMode: 'any'
  };

  // Add filters if provided
  if (Object.keys(filters).length > 0) {
    searchOptions.filter = Object.entries(filters)
      .map(([key, value]) => `${key} eq '${value}'`)
      .join(' and ');
  }

  // If we have a query embedding, use vector search
  if (queryEmbedding && Array.isArray(queryEmbedding)) {
    searchOptions.vectorSearchOptions = {
      queries: [{
        kind: "vector",
        vector: queryEmbedding,
        fields: ["vector"],
        kNearestNeighborsCount: topK
      }]
    };
    console.log(`🔍 Performing vector search with ${queryEmbedding.length} dimensions`);
  }

  try {
    const searchResults = await client.search(query, searchOptions);
    const results = [];
    
    for await (const result of searchResults.results) {
      results.push({
        score: result.score,
        document: result.document
      });
    }
    
    console.log(`✅ Found ${results.length} results using ${queryEmbedding ? 'vector' : 'text'} search`);
    return results;
  } catch (error) {
    throw new Error(`Failed to search documents: ${error.message}`);
  }
}

async function vectorSearch(queryEmbedding, topK = 5, filters = {}) {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 1536) {
    throw new Error('Query embedding must be a 1536-dimensional vector');
  }

  return searchDocuments('', topK, filters, queryEmbedding);
}

/**
 * Hybrid search combines text and vector search
 */
async function hybridSearch(query, queryEmbedding, topK = 5, filters = {}) {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 1536) {
    throw new Error('Query embedding must be a 1536-dimensional vector');
  }

  return searchDocuments(query, topK, filters, queryEmbedding);
}

/**
 * Get index statistics
 * @returns {Promise<Object>} - Index statistics
 */
async function getIndexStats() {
  try {
    const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const apiKey = process.env.AZURE_SEARCH_API_KEY;
    const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

    const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));
    const index = await indexClient.getIndex(indexName);
    const stats = await indexClient.getIndexStatistics(indexName);
    
    return {
      name: index.name,
      fields: index.fields.length,
      vectorSearch: index.vectorSearch ? 'Enabled' : 'Disabled',
      vectorFields: index.fields.filter(f => f.vectorSearchDimensions).length,
      documentCount: stats.documentCount,
      storageSize: stats.storageSize
    };
  } catch (error) {
    throw new Error(`Failed to get index stats: ${error.message}`);
  }
}

module.exports = { 
  storeInSearch, 
  searchDocuments, 
  vectorSearch,
  hybridSearch,
  getIndexStats, 
  getSearchClient 
}; 