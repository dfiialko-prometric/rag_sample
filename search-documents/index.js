const { app } = require('@azure/functions');
const { searchDocuments } = require('../shared/searchClient');

app.http('searchDocuments', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('Search documents function started');

      let query, topK = 5, filters = {};

      if (request.method === 'GET') {
        // Handle GET request with query parameters
        query = request.query.get('q');
        const topKParam = request.query.get('top');
        if (topKParam) {
          topK = parseInt(topKParam);
        }
      } else {
        // Handle POST request with JSON body
        const body = await request.json();
        query = body.query;
        topK = body.top || 5;
        filters = body.filters || {};
      }

      if (!query) {
        return {
          status: 400,
          body: {
            success: false,
            error: 'Query parameter "q" is required'
          }
        };
      }

      context.log(`Searching for: "${query}" with topK: ${topK}`);

      // Search documents
      const results = await searchDocuments(query, topK, filters);

      return {
        status: 200,
        body: {
          success: true,
          query: query,
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
              uploadDate: result.document.uploadDate
            }
          }))
        }
      };

    } catch (error) {
      context.error('Search error:', error);
      return {
        status: 500,
        body: {
          success: false,
          error: error.message
        }
      };
    }
  }
}); 