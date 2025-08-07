const { SearchIndexClient, AzureKeyCredential } = require('@azure/search-documents');
require('dotenv').config();

async function createSimpleSearchIndex() {
  try {
    console.log('Creating Azure AI Search index...\n');

    // Get configuration from environment
    const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const searchApiKey = process.env.AZURE_SEARCH_API_KEY;
    const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME || 'rag-documents-simple';

    if (!searchEndpoint || !searchApiKey) {
      throw new Error('Azure AI Search configuration missing. Please check AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_API_KEY in .env');
    }
   
    // Create search index client
    const indexClient = new SearchIndexClient(
      searchEndpoint,
      new AzureKeyCredential(searchApiKey)
    );

    // Simple index definition without vector search for now
    const indexDefinition = {
      name: searchIndexName,
      fields: [
        {
          name: 'id',
          type: 'Edm.String',
          key: true,
          searchable: false,
          filterable: false,
          sortable: false,
          facetable: false,
          retrievable: true
        },
        {
          name: 'documentId',
          type: 'Edm.String',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: true,
          retrievable: true
        },
        {
          name: 'filename',
          type: 'Edm.String',
          searchable: true,
          filterable: true,
          sortable: true,
          facetable: true,
          retrievable: true
        },
        {
          name: 'chunkIndex',
          type: 'Edm.Int32',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: false,
          retrievable: true
        },
        {
          name: 'content',
          type: 'Edm.String',
          searchable: true,
          filterable: false,
          sortable: false,
          facetable: false,
          retrievable: true,
          analyzerName: 'en.microsoft'
        },
        {
          name: 'chunkSize',
          type: 'Edm.Int32',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: false,
          retrievable: true
        },
        {
          name: 'uploadDate',
          type: 'Edm.DateTimeOffset',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: false,
          retrievable: true
        },
        {
          name: 'fileType',
          type: 'Edm.String',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: true,
          retrievable: true
        },
        {
          name: 'hasContent',
          type: 'Edm.Boolean',
          searchable: false,
          filterable: true,
          sortable: true,
          facetable: false,
          retrievable: true
        }
      ]
    };

    console.log('\nSchema:');
    console.log('- Fields:', indexDefinition.fields.length);
    console.log('- Text search: enabled');
    console.log('- Vector search: disabled');

    // Check if index already exists
    try {
      const existingIndex = await indexClient.getIndex(searchIndexName);
          console.log('\nIndex exists:');
    console.log('- Name:', existingIndex.name);
    console.log('- Fields:', existingIndex.fields.length);
      
      const shouldDelete = process.argv.includes('--force');
      if (shouldDelete) {
            console.log('\nDeleting existing index...');
    await indexClient.deleteIndex(searchIndexName);
    console.log('Index deleted');
      } else {
            console.log('\nTo recreate the index, run: node create-simple-search-index.js --force');
    return;
      }
    } catch (error) {
      // Index doesn't exist, which is what we want
      console.log('\nIndex does not exist, creating...');
    }

    // Create the index
    console.log('\nCreating index...');
    await indexClient.createIndex(indexDefinition);
    
    console.log('\nIndex created!');
    console.log('\nDetails:');
    console.log('- Name:', searchIndexName);
    console.log('- Text search: enabled');
    console.log('- Ready for documents');

    console.log('\nRAG system ready!');
    console.log('\nNext:');
    console.log('1. Test upload and search');
    console.log('2. Add vector search later');
    console.log('3. Create functions');

  } catch (error) {
    console.error('\nFailed to create search index:', error.message);
    
    if (error.message.includes('authentication')) {
      console.log('\nCheck your Azure AI Search API key in .env file');
    } else if (error.message.includes('endpoint')) {
      console.log('\nCheck your Azure AI Search endpoint in .env file');
    }
  }
}

// Run the script
createSimpleSearchIndex(); 