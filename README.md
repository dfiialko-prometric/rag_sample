# RAG Azure Functions

A Retrieval-Augmented Generation (RAG) system built with Azure Functions, Azure AI Search, and OpenAI. This system allows you to upload documents, search through them semantically, and generate AI-powered responses based on the retrieved content.

## Features

- **Document Processing**: Upload and parse PDF and Word documents
- **Semantic Chunking**: Split documents into meaningful chunks using Langchain
- **Vector Search**: Store and search document embeddings in Azure AI Search
- **AI Response Generation**: Generate contextual responses using OpenAI GPT models
- **Serverless Architecture**: Built on Azure Functions for scalability

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Document      │    │   Azure AI       │    │   OpenAI        │
│   Upload        │───▶│   Search         │───▶│   GPT Models    │
│   (PDF/Word)    │    │   (Vector Store) │    │   (Response)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       ▲                       │
         ▼                       │                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Document      │    │   Semantic       │    │   AI Response   │
│   Parser        │    │   Search         │    │   Generation    │
│   (Text Extract)│    │   (Query)        │    │   (Context)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Azure Functions

### 1. `uploadDocuments`
- **Method**: POST
- **Purpose**: Upload and process documents
- **Input**: Multipart form data with document file
- **Output**: Processing status and document ID

### 2. `searchDocuments`
- **Method**: GET/POST
- **Purpose**: Search through uploaded documents
- **Input**: Query string and optional filters
- **Output**: Relevant document chunks with scores

### 3. `generateResponse`
- **Method**: GET/POST
- **Purpose**: Generate AI responses based on search results
- **Input**: Question and optional context
- **Output**: AI-generated response with source references

## Prerequisites

- Node.js 18+ 
- Azure Functions Core Tools v4
- Azure subscription with:
  - Azure Functions App
  - Azure AI Search service
  - Azure OpenAI service (optional, can use OpenAI directly)

## Setup

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd rag_sample (cloned repo folder)
npm install
```

### 2. Environment Configuration

Copy the environment template and configure your settings:

```bash
cp env.example .env
```

Update `.env` with your actual values:

```env
# Azure AI Search Configuration
AZURE_SEARCH_ENDPOINT=https://your-search-service.search.windows.net
AZURE_SEARCH_API_KEY=your-search-api-key
AZURE_SEARCH_INDEX_NAME=rag-documents

# OpenAI Configuration (Personal or Azure)
OPENAI_API_KEY=your-openai-api-key

# Azure OpenAI (Optional)
AZURE_OPENAI_ENDPOINT=https://your-openai-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-azure-openai-key
AZURE_OPENAI_DEPLOYMENT_NAME=your-embedding-deployment
AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=your-chat-deployment

# Azure Function Configuration
AZURE_FUNCTION_URL=https://your-function-app.azurewebsites.net
```

### 3. Azure AI Search Setup - already setup

Create the search index using the provided script:

```bash
node create-simple-search-index.js
```

### 4. Local Development

Start the Azure Functions locally:

```bash
npm start
```

The functions will be available at:
- `http://localhost:7071/api/uploadDocuments`
- `http://localhost:7071/api/searchDocuments`
- `http://localhost:7071/api/generateResponse`

## Usage

### Upload a Document

```bash
curl -X POST http://localhost:7071/api/uploadDocuments \
  -F "document=@/path/to/your/document.pdf"
```

### Search Documents

```bash
curl "http://localhost:7071/api/searchDocuments?q=your search query"
```

### Generate AI Response

```bash
curl "http://localhost:7071/api/generateResponse?question=What is this about?"
```

## Project Structure

```
├── shared/                    # Shared utilities
│   ├── documentParser.js     # PDF/Word document parsing
│   ├── chunker.js           # Text chunking with Langchain
│   ├── embeddings.js        # OpenAI embeddings generation
│   └── searchClient.js      # Azure AI Search client
├── upload-documents/         # Document upload function
├── search-documents/         # Search function
├── generate-response/        # AI response generation
├── host.json                # Azure Functions configuration
├── package.json             # Dependencies and scripts
└── index.js                 # Function registration
```

## Dependencies

- **@azure/functions**: Azure Functions v4 runtime
- **@azure/search-documents**: Azure AI Search client
- **@azure/openai**: Azure OpenAI client
- **langchain**: Text chunking and processing
- **pdf-parse**: PDF document parsing
- **mammoth**: Word document parsing
- **multer**: File upload handling
- **axios**: HTTP client for OpenAI API
- **dotenv**: Environment variable management

## Deployment

### Deploy to Azure

1. **Azure Functions Extension**: Use VS Code Azure Functions extension
2. **Azure CLI**: Use `az functionapp deployment` commands
3. **GitHub Actions**: Set up CI/CD pipeline

### Environment Variables in Azure

Configure the same environment variables in your Azure Function App settings through the Azure portal or Azure CLI.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Check the Azure Functions documentation
- Review Azure AI Search setup guides
- Open an issue in this repository 
