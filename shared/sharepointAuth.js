const { Client } = require('@microsoft/microsoft-graph-client');
const { ConfidentialClientApplication } = require('@azure/msal-node');

// Create MSAL instance for authentication
function createMSALInstance() {
  const clientConfig = {
    auth: {
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
      redirectUri: 'https://rag-function-app-hmcdh9hddrbehkdv.canadacentral-01.azurewebsites.net/api/sharepointsync'
    }
  };
  
  return new ConfidentialClientApplication(clientConfig);
}

// Generate login URL for user authentication
async function getLoginUrl() {
  try {
    const msalInstance = createMSALInstance();
    
    const authCodeUrlParameters = {
      scopes: ['https://graph.microsoft.com/User.Read'],
      redirectUri: 'https://rag-function-app-hmcdh9hddrbehkdv.canadacentral-01.azurewebsites.net/api/sharepointsync'
    };
    
    const authUrl = await msalInstance.getAuthCodeUrl(authCodeUrlParameters);
    return authUrl;
  } catch (error) {
    throw new Error(`Failed to generate login URL: ${error.message}`);
  }
}

// Exchange authorization code for access token
async function getAccessTokenFromCode(authCode) {
  try {
    const msalInstance = createMSALInstance();
    
    const tokenRequest = {
      code: authCode,
      scopes: ['https://graph.microsoft.com/User.Read'],
      redirectUri: 'https://rag-function-app-hmcdh9hddrbehkdv.canadacentral-01.azurewebsites.net/api/sharepointsync'
    };
    
    const response = await msalInstance.acquireTokenByCode(tokenRequest);
    return response.accessToken;
  } catch (error) {
    throw new Error(`Token exchange failed: ${error.message}`);
  }
}

// For demo/testing - try to use a pre-obtained token
async function getAccessToken() {
  // This is a fallback that will fail - we need user interaction
  throw new Error('User authentication required. Please use the login flow.');
}

// Create authenticated Graph client with provided token
function createGraphClientWithToken(accessToken) {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    }
  });
}

// Create Graph client (will fail without user auth)
async function createGraphClient() {
  const accessToken = await getAccessToken();
  return createGraphClientWithToken(accessToken);
}

module.exports = { 
  getLoginUrl, 
  getAccessTokenFromCode, 
  createGraphClientWithToken, 
  createGraphClient,
  getAccessToken 
};