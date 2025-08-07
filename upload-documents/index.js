const { app } = require('@azure/functions');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

// Import shared utilities
const { parseDocument } = require('../shared/documentParser');
const { chunkText } = require('../shared/chunker');
const { createEmbeddings } = require('../shared/embeddings');
const { storeInSearch } = require('../shared/searchClient');

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadDir = path.join(__dirname, '../uploads');
      try {
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.doc'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and Word documents are allowed.'));
    }
  }
});

app.http('uploadDocuments', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('Upload documents function started');

      // Handle file upload with multer
      const uploadMiddleware = upload.single('document');
      
      return new Promise((resolve, reject) => {
        uploadMiddleware(request, {}, async (err) => {
          if (err) {
            context.error('File upload error:', err);
            resolve({
              status: 400,
              body: {
                success: false,
                error: err.message
              }
            });
            return;
          }

          if (!request.file) {
            resolve({
              status: 400,
              body: {
                success: false,
                error: 'No file uploaded'
              }
            });
            return;
          }

          try {
            const filePath = request.file.path;
            const filename = request.file.originalname;
            const documentId = uuidv4();

            context.log(`Processing ${filename}`);

            // 1. Parse document
            const text = await parseDocument(filePath);
            context.log(`Extracted ${text.length} chars`);

            // 2. Chunk text
            const chunks = await chunkText(text);
            context.log(`Created ${chunks.length} chunks`);

            // 3. Create embeddings
            const embeddings = await createEmbeddings(chunks);
            context.log(`Generated ${embeddings.length} embeddings`);

            // 4. Store in Azure AI Search
            await storeInSearch(documentId, filename, chunks, embeddings);
            context.log('Stored in search');

            // Clean up uploaded file
            await fs.unlink(filePath);

            resolve({
              status: 200,
              body: {
                success: true,
                documentId: documentId,
                filename: filename,
                chunksProcessed: chunks.length,
                embeddingsCreated: embeddings.length,
                message: 'Document processed and stored successfully'
              }
            });

          } catch (error) {
            context.error('Processing error:', error);
            
            // Clean up uploaded file on error
            if (request.file) {
              try {
                await fs.unlink(request.file.path);
              } catch (cleanupError) {
                context.error('Failed to cleanup file:', cleanupError);
              }
            }

            resolve({
              status: 500,
              body: {
                success: false,
                error: error.message
              }
            });
          }
        });
      });

    } catch (error) {
      context.error('Function error:', error);
      return {
        status: 500,
        body: {
          success: false,
          error: 'Internal server error'
        }
      };
    }
  }
}); 