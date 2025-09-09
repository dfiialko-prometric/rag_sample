const createClient = require("@azure-rest/ai-content-safety").default;
const { AzureKeyCredential } = require("@azure/core-auth");
require('dotenv').config();


async function checkWithContentSafety(text) {
    const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
    const key = process.env.AZURE_CONTENT_SAFETY_KEY;
    
    // If Content Safety is not configured, skip the check
    if (!endpoint || !key) {
        console.log("Azure Content Safety not configured, skipping content safety check");
        return true; // Allow content through if not configured
    }

    try {
        const client = new createClient(endpoint, new AzureKeyCredential(key));
        
        const response = await client.path("/text:analyze").post({
            body: {
                text: text,
                categories: ["Credentials", "Confidential"],
            },
        });
        
        if (response.status !== "200") {
            throw new Error(`Content Safety API error: ${response.status}`);
        }
        
        // Define thresholds
        const thresholds = {
            Credentials: 2,      // 0 = safe, 1 = low, 2 = medium, 3 = high
            Confidential: 2,
        };

        // Check categories
        const analysis = response.body;
        for (const result of analysis.categoriesAnalysis) {
            const category = result.category;
            const severity = result.severity;
            console.log(`Category: ${category}, Severity: ${severity}`);
            if (severity >= thresholds[category]) {
                console.warn(`Content flagged: ${category} severity ${severity}`);
                return false;
            }
        }
        return true;
    } catch (err) {
        console.error("Content Safety API error:", err);
        // On error, allow content through to prevent blocking uploads
        console.log("Allowing content through due to Content Safety error");
        return true;
    }
}

module.exports = { checkWithContentSafety };