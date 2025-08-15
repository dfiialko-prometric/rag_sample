# Local Processing Mode

## Current Status
The application is currently configured to use **local processing and upload** instead of Azure Functions for document uploads.

## What's Changed

### 1. Frontend (`public/app.js`)
- **Commented out**: Azure Function upload code
- **Added**: Local processing endpoint call (`/process-and-upload`)
- **Markers**: Clear TODO comments for easy restoration

### 2. Backend (`server.js`)
- **Added**: Local `/process-and-upload` endpoint
- **Uses**: `process-and-upload.js` script for file processing
- **Handles**: File uploads with multer, temporary file cleanup

### 3. Processing (`process-and-upload.js`)
- **Enhanced**: Returns chunk count for web UI
- **Maintains**: Azure upload functionality (still uploads to Azure Search)

## How It Works

1. **File Upload**: User uploads file through web UI
2. **Local Processing**: File sent to `/process-and-upload` endpoint
3. **Text Extraction**: `process-and-upload.js` extracts text from file
4. **Azure Upload**: Text chunks uploaded to Azure AI Search
5. **Response**: Success/failure returned to web UI

## Benefits of Local Mode

- ✅ **PDF Support**: Can process PDF files locally
- ✅ **Word Support**: Can process Word documents locally
- ✅ **Better Error Handling**: More detailed error messages
- ✅ **File Size Control**: 10MB upload limit
- ✅ **Temporary File Cleanup**: Automatic cleanup of uploaded files

## To Switch Back to Azure Functions

### 1. Restore Frontend (`public/app.js`)
```javascript
// Find this section and uncomment the Azure function code:
// ========================================
// ORIGINAL AZURE FUNCTION CODE (COMMENTED OUT)
// ========================================
/*
// Extract text from the file
const text = await extractTextFromFile(file);
// ... rest of Azure function code
*/
// ========================================
// END ORIGINAL AZURE FUNCTION CODE
// ========================================

// And comment out the local processing code:
// ========================================
// TEMPORARY: LOCAL PROCESS AND UPLOAD
// ========================================
```

### 2. Remove Backend Endpoint (`server.js`)
```javascript
// Remove this entire section:
// ========================================
// TEMPORARY: LOCAL PROCESS AND UPLOAD ENDPOINT
// ========================================
app.post('/process-and-upload', upload.single('file'), async (req, res) => {
    // ... entire endpoint code
});
// ========================================
// END LOCAL PROCESS AND UPLOAD ENDPOINT
// ========================================
```

### 3. Remove Dependencies (`server.js`)
```javascript
// Remove these imports:
const multer = require('multer');
const fs = require('fs');
const { processFile } = require('./process-and-upload');

// Remove multer configuration:
const upload = multer({ ... });
```

### 4. Update Title (`public/index.html`)
```html
<title>ProChat</title>  <!-- Remove "Local Processing Mode" -->
```

## Current Limitations

- ⚠️ **Local Server Required**: Must run `node server.js` for uploads
- ⚠️ **File Size Limit**: 10MB maximum file size
- ⚠️ **Temporary Storage**: Files stored temporarily in `uploads/` directory

## Testing

1. Start the local server: `npm run ui`
2. Open browser to `http://localhost:3000`
3. Upload a document (PDF, Word, or Text)
4. Verify processing and upload to Azure Search
5. Test question answering functionality

## Files Modified

- `public/app.js` - Frontend upload logic
- `server.js` - Backend endpoint
- `process-and-upload.js` - Enhanced return values
- `public/index.html` - Title update
- `uploads/` - Temporary file directory (auto-created)

## Environment Variables

Still requires the same environment variables for Azure AI Search:
- `AZURE_SEARCH_ENDPOINT`
- `AZURE_SEARCH_API_KEY`
- `AZURE_SEARCH_INDEX_NAME`
- `OPENAI_API_KEY`
