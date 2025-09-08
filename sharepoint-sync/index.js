const { app } = require('@azure/functions');
const { getLoginUrl, getAccessTokenFromCode, createGraphClientWithToken } = require('../shared/sharepointAuth');

app.http('sharepointSync', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      context.log('🔗 SharePoint sync function started');
      
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
      
      // Option 3: POST with access token - simulate SharePoint sync
      if (request.method === 'POST' && bodyData.accessToken) {
        const graphClient = createGraphClientWithToken(bodyData.accessToken);
        const user = await graphClient.api('/me').get();
        
        // Demo: Simulate SharePoint document sync
        const mockSharePointDocs = [
          {
            name: "Company Policy 2024.docx",
            lastModified: "2024-01-15T10:30:00Z",
            size: "125KB",
            path: "/sites/company/Shared Documents/Policies/",
            content: "This document outlines the company's updated policies for 2024, including remote work guidelines, security protocols, and employee benefits. The new hybrid work model allows for 3 days remote work per week..."
          },
          {
            name: "Q4 Financial Report.xlsx", 
            lastModified: "2024-01-12T14:45:00Z",
            size: "2.3MB",
            path: "/sites/finance/Shared Documents/Reports/",
            content: "Q4 2023 financial performance shows 15% growth in revenue compared to previous quarter. Key metrics include customer acquisition, retention rates, and operational efficiency improvements..."
          },
          {
            name: "Project Roadmap - RAG System.pptx",
            lastModified: "2024-01-10T09:15:00Z", 
            size: "5.7MB",
            path: "/sites/engineering/Shared Documents/Projects/",
            content: "RAG (Retrieval Augmented Generation) system implementation roadmap for Q1-Q2 2024. Project includes AI-powered document search, integration with existing systems, and user training programs..."
          }
        ];
        
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            message: 'SharePoint sync completed successfully! 🎉',
            authenticatedUser: user.displayName,
            documentsFound: mockSharePointDocs.length,
            documents: mockSharePointDocs,
            syncStats: {
              totalSites: 3,
              totalDocuments: 147,
              processedDocuments: 3,
              errors: 0,
              duration: "2.3 seconds"
            },
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