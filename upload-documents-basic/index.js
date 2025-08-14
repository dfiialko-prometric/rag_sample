const { app } = require('@azure/functions');
const { v4: uuidv4 } = require('uuid');

const { chunkText } = require('../shared/chunker');
const { storeInSearch } = require('../shared/searchClientBasic');

app.http('uploadDocumentsBasic', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('Upload documents function started');

      // Get text content from request body
      const body = await request.text();
      
      if (!body || body.trim().length === 0) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: 'No text content provided'
          }
        };
      }

      // Parse JSON if needed, otherwise use as plain text
      let textContent = '';
      let filename = `document-${Date.now()}.txt`;
      
      try {
        const jsonBody = JSON.parse(body);
        textContent = jsonBody.text || jsonBody.content || body;
        filename = jsonBody.filename || filename;
      } catch {
        // Not JSON, use as plain text
        textContent = body;
      }

      context.log(`Processing text content (${textContent.length} chars)`);

      // Generate document ID
      const documentId = uuidv4();

      // Chunk text
      const chunks = await chunkText(textContent);
      context.log(`Created ${chunks.length} chunks`);

      // Store in search (without embeddings for basic version)
      await storeInSearch(documentId, filename, chunks, []);
      context.log('Stored in search');

      return {
        status: 200,
        jsonBody: {
          success: true,
          documentId: documentId,
          filename: filename,
          chunksProcessed: chunks.length,
          embeddingsCreated: 0,
          searchMode: 'text',
          message: 'Text content processed and stored',
          contentLength: textContent.length
        }
      };

    } catch (error) {
      context.error('Function error:', error);
      return {
        status: 500,
        jsonBody: {
          success: false,
          error: error.message
        }
      };
    }
  }
}); 