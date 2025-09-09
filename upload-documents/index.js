const { app } = require('@azure/functions');
const { v4: uuidv4 } = require('uuid');
const multipart = require('parse-multipart');

// Import shared utilities
const { parseDocumentContent } = require('../shared/documentParser');
const { chunkText } = require('../shared/chunker');
const { createEmbeddings } = require('../shared/embeddings');
const { storeInSearch } = require('../shared/searchClient');

app.http('uploadDocuments', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('Upload documents function started');
      
      const contentType = request.headers.get('content-type') || '';
      
      if (!contentType.includes('multipart/form-data')) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Content-Type must be multipart/form-data'
          })
        };
      }

      // Parse the multipart form data
      const rawBody = Buffer.from(await request.arrayBuffer());
      const boundary = multipart.getBoundary(contentType);
      
      if (!boundary) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Could not extract boundary from Content-Type header'
          })
        };
      }
      
      const files = multipart.Parse(rawBody, boundary);
      
      if (!files || files.length === 0) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'No files found in the request'
          })
        };
      }

      const results = [];
      
      // Process each uploaded file
      for (const file of files) {
        try {
          context.log(`Processing file: ${file.filename || 'unnamed'}`);
          
          // Generate unique document ID
          const documentId = uuidv4();
          const filename = file.filename || `upload-${documentId}`;
          
          // Parse the document directly from buffer (don't convert binary files to UTF-8)
          const parsedDoc = await parseDocumentContent(file.data, filename);
          
          // Create text chunks
          const chunks = await chunkText(parsedDoc.text);
       
          // Check if we have any chunks to process
          if (chunks.length === 0) {
            context.log(`No chunks created for ${filename} - text may be too short or filtered out`);
            results.push({
              filename: filename,
              success: false,
              error: 'No text chunks could be created from this document'
            });
            continue;
          }

          // Generate embeddings
          const embeddings = await createEmbeddings(chunks);

          await storeInSearch(documentId, filename, chunks, embeddings);
          
          results.push({
            filename: filename,
            documentId: documentId,
            chunksCreated: chunks.length,
            embeddingsCreated: embeddings.length,
            fileSize: file.data.length,
            fileType: parsedDoc.type || 'text/plain'
          });
          
          context.log(`Successfully processed: ${filename}`);
          
        } catch (fileError) {
          context.error(`Error processing file ${file.filename}:`, fileError);
          results.push({
            filename: file.filename || 'unnamed',
            error: fileError.message,
            success: false
          });
        }
      }
      
      const successCount = results.filter(r => !r.error).length;
      
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: successCount > 0,
          message: `Processed ${successCount} out of ${results.length} files successfully`,
          filesProcessed: successCount,
          totalFiles: results.length,
          results: results
        })
      };

    } catch (error) {
      context.error('Function error:', error);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: `Internal server error: ${error.message}`
        })
      };
    }
  }
}); 