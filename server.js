const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');

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

// Azure Functions endpoints
const AZURE_FUNCTION_BASE = 'https://rag-function-app-hmcdh9hddrbehkdv.canadacentral-01.azurewebsites.net/api';

// Upload endpoint that forwards to Azure Functions
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        console.log(`Uploading file: ${req.file.originalname}`);

        // Create form data for Azure Function
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('document', fs.createReadStream(req.file.path), {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        // Forward to Azure Function
        const response = await axios.post(`${AZURE_FUNCTION_BASE}/uploaddocuments`, formData, {
            headers: {
                ...formData.getHeaders(),
            },
            timeout: 120000 // 2 minutes timeout for processing
        });

        // Clean up the temporary file
        fs.unlinkSync(req.file.path);

        // Return the Azure Function response
        res.json(response.data);

    } catch (error) {
        console.error('Error uploading file:', error);
        
        // Clean up the temporary file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            success: false,
            error: error.response?.data?.error || error.message || 'Failed to upload file'
        });
    }
});

// Search endpoint that forwards to Azure Functions
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        const searchType = req.query.type || 'hybrid';
        const top = req.query.top || 5;

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Query parameter "q" is required'
            });
        }

        console.log(`Searching for: "${query}" with type: ${searchType}`);

        const response = await axios.get(`${AZURE_FUNCTION_BASE}/searchdocuments`, {
            params: { q: query, type: searchType, top: top }
        });

        res.json(response.data);

    } catch (error) {
        console.error('Error searching:', error);
        res.status(500).json({
            success: false,
            error: error.response?.data?.error || error.message || 'Search failed'
        });
    }
});

// Generate response endpoint that forwards to Azure Functions
app.get('/ask', async (req, res) => {
    try {
        const question = req.query.question;

        if (!question) {
            return res.status(400).json({
                success: false,
                error: 'Question parameter is required'
            });
        }

        console.log(`Generating response for: "${question}"`);

        const response = await axios.get(`${AZURE_FUNCTION_BASE}/generateresponse`, {
            params: { 
                question: question,
                sessionId: req.query.sessionId || 'default'
            }
        });

        res.json(response.data);

    } catch (error) {
        console.error('Error generating response:', error);
        res.status(500).json({
            success: false,
            error: error.response?.data?.error || error.message || 'Failed to generate response'
        });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`RAG Web UI is running on http://localhost:${PORT}`);
    console.log(`Upload endpoint: http://localhost:${PORT}/upload`);
    console.log(`Search endpoint: http://localhost:${PORT}/search`);
    console.log(`Ask endpoint: http://localhost:${PORT}/ask`);
});

module.exports = app; 