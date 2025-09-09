const createClient = require("@azure-rest/ai-content-safety").default;
const { AzureKeyCredential } = require("@azure/core-auth");
require('dotenv').config();


async function checkWithContentSafety(text) {
    const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
    const key = process.env.AZURE_CONTENT_SAFETY_KEY
    const client = new createClient(endpoint, new AzureKeyCredential(key));

    try {
        const response = await client.path("/text:analyze").post({
            body: {
                text: text,
                categories: ["Hate", "Sexual", "SelfHarm", "Violence"],
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
        return false;
    }
}

module.exports = { checkWithContentSafety };