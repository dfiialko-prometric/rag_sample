const { app } = require('@azure/functions');
const { searchDocuments, vectorSearch, hybridSearch } = require('../shared/searchClient');
const { createEmbeddings } = require('../shared/embeddings');

app.http('searchDocuments', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('Search documents function started');

      let query, topK = 5, filters = {}, searchType = 'text';

      if (request.method === 'GET') {
        // Handle GET request with query parameters
        query = request.query.get('q');
        const topKParam = request.query.get('top');
        const searchTypeParam = request.query.get('type');
        if (topKParam) {
          topK = parseInt(topKParam);
        }
        if (searchTypeParam) {
          searchType = searchTypeParam; // 'text', 'vector', or 'hybrid'
        }
      } else {
        // Handle POST request with JSON body
        const body = await request.json();
        query = body.query;
        topK = body.top || 5;
        filters = body.filters || {};
        searchType = body.searchType || 'text';
      }

      if (!query && searchType !== 'vector') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Query parameter "q" is required for text and hybrid search'
          })
        };
      }

      context.log(`Searching for: "${query || 'vector search'}" with type: ${searchType}, topK: ${topK}`);

      let results;

      // Perform search based on type
      switch (searchType) {
        case 'vector':
          // Create embedding for the query and perform vector search
          try {
            const queryEmbedding = await createEmbeddings([query || '']);
            results = await vectorSearch(queryEmbedding[0], topK, filters);
            context.log(`Vector search completed with ${results.length} results`);
          } catch (error) {
            context.error('Vector search error:', error);
            return {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                success: false,
                error: `Vector search failed: ${error.message}`
              })
            };
          }
          break;

        case 'hybrid':
          // Create embedding for the query and perform hybrid search
          try {
            const queryEmbedding = await createEmbeddings([query]);
            results = await hybridSearch(query, queryEmbedding[0], topK, filters);
            context.log(`Hybrid search completed with ${results.length} results`);
          } catch (error) {
            context.error('Hybrid search error:', error);
            return {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                success: false,
                error: `Hybrid search failed: ${error.message}`
              })
            };
          }
          break;

        default:
          // Default to text search
          results = await searchDocuments(query, topK, filters);
          context.log(`Text search completed with ${results.length} results`);
          break;
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          query: query,
          searchType: searchType,
          topK: topK,
          resultsCount: results.length,
          results: results.map(result => ({
            score: result.score,
            document: {
              id: result.document.id,
              documentId: result.document.documentId,
              filename: result.document.filename,
              chunkIndex: result.document.chunkIndex,
              content: result.document.content,
              chunkSize: result.document.chunkSize,
              uploadDate: result.document.uploadDate,
              fileType: result.document.fileType
            }
          }))
        })
      };

    } catch (error) {
      context.error('Search error:', error);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }
  }
}); 