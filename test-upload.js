const axios = require('axios');

const BASE_URL = 'https://prochat-function-app-d2gnekb9cadvfmes.canadacentral-01.azurewebsites.net/api';

async function testUpload() {
  try {
    console.log('Testing upload with sample text...');
    
    const testPayload = {
      text: "This is a test document for the RAG system. It contains some sample content to verify that the upload and processing pipeline is working correctly. This should be long enough to create at least one chunk.",
      filename: "test-document.txt"
    };

    console.log('Payload:', JSON.stringify(testPayload, null, 2));

    const response = await axios.post(`${BASE_URL}/uploadDocumentsBasic`, testPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testUpload();
