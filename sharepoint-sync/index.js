const { app } = require('@azure/functions');
const { getLoginUrl, getAccessTokenFromCode, createGraphClientWithToken } = require('../shared/sharepointAuth');

app.http('sharepointSync', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('SharePoint sync function started');
      
      const url = new URL(request.url);
      const authCode = url.searchParams.get('code');
      const requestBody = await request.text();
      let bodyData = {};
      
      try {
        if (requestBody) bodyData = JSON.parse(requestBody);
      } catch (e) {
        // Not JSON, that's fine
      }
      
      // Option 1: User wants to start login flow
      if (request.method === 'GET' && !authCode) {
        const loginUrl = await getLoginUrl();
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            action: 'login_required',
            loginUrl: loginUrl,
            message: 'Please visit the login URL to authenticate'
          })
        };
      }
      
      // Option 2: User returned from login with auth code
      if (authCode) {
        const accessToken = await getAccessTokenFromCode(authCode);
        const graphClient = createGraphClientWithToken(accessToken);
        
        // Test basic Graph API call (user info - no SharePoint permissions needed)
        const user = await graphClient.api('/me').get();
        context.log('Authenticated user:', user.displayName);
        
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            message: 'Microsoft Graph authentication successful!',
            userName: user.displayName,
            accessToken: accessToken.substring(0, 20) + '...', // Show partial token
            timestamp: new Date().toISOString()
          })
        };
      }
      
      // Option 3: POST with access token - real SharePoint sync
      if (request.method === 'POST' && bodyData.accessToken) {
        const graphClient = createGraphClientWithToken(bodyData.accessToken);
        const user = await graphClient.api('/me').get();
        
        // TODO: Implement SharePoint document sync
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            message: 'SharePoint authentication successful - ready for real sync implementation',
            authenticatedUser: user.displayName,
            note: 'Real SharePoint document sync not yet implemented',
            timestamp: new Date().toISOString()
          })
        };
      }
      
      // Default: Show available options
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'SharePoint sync function ready',
          options: [
            'GET: Start login flow',
            'GET with ?code=: Complete login',
            'POST with {"accessToken": "..."}: Use existing token'
          ]
        })
      };
      
    } catch (error) {
      context.error('SharePoint sync error:', error);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: error.message,
          details: error.stack?.split('\n')[0] || 'Authentication error'
        })
      };
    }
  }
});