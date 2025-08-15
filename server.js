const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { processFile } = require('./process-and-upload');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// TEMPORARY: LOCAL PROCESS AND UPLOAD ENDPOINT
// ========================================
// TODO: REMOVE WHEN SWITCHING BACK TO AZURE FUNCTIONS
// ========================================
app.post('/process-and-upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        console.log(`Processing file: ${req.file.originalname}`);

        // Process the uploaded file using our local process-and-upload script
        const result = await processFile(req.file.path, req.file.originalname);

        // Clean up the temporary file
        fs.unlinkSync(req.file.path);

        // Return success response
        res.json({
            success: true,
            filename: req.file.originalname,
            chunksProcessed: result.chunksProcessed || 1,
            message: 'File processed and uploaded successfully'
        });

    } catch (error) {
        console.error('Error processing file:', error);
        
        // Clean up the temporary file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process file'
        });
    }
});
// ========================================
// END LOCAL PROCESS AND UPLOAD ENDPOINT
// ========================================

// Start the server
app.listen(PORT, () => {
    console.log(`RAG Web UI is running on http://localhost:${PORT}`);
    console.log(`Local process-and-upload endpoint: http://localhost:${PORT}/process-and-upload`);
});

module.exports = app; 