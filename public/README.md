# RAG Web UI

A simple, modern web interface for the RAG (Retrieval-Augmented Generation) system.

## Features

- 📄 **Document Upload**: Drag & drop or click to upload text documents
- 💬 **Interactive Chat**: Ask questions and get AI-powered answers
- 📊 **Real-time Stats**: Track documents, questions, and chunks
- 📱 **Responsive Design**: Works on desktop and mobile
- 🎨 **Modern UI**: Clean, professional interface

## Usage

1. **Start the web UI**:
   ```bash
   npm run ui
   ```

2. **Open your browser** to `http://localhost:3000`

3. **Upload a document** by dragging and dropping or clicking "Choose File"

4. **Ask questions** about your uploaded documents in the chat interface

## Supported File Types

- ✅ **Text files** (`.txt`) - Direct upload via web UI
- ✅ **PDF files** (`.pdf`) - Use `process-and-upload.js` script
- ✅ **Word documents** (`.docx`, `.doc`) - Use `process-and-upload.js` script

## Configuration

Update the `API_BASE_URL` in `app.js` to point to your Azure Functions endpoint:

```javascript
const API_BASE_URL = 'https://your-function-app.azurewebsites.net/api';
```

## Architecture

The web UI communicates with your Azure Functions:
- `uploadDocumentsBasic` - For document upload and processing
- `generateResponse` - For AI-powered question answering 