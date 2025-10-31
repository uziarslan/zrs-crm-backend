const axios = require('axios');

async function testWebhookRawBody() {
    try {
        console.log('🧪 Testing DocuSign webhook with raw body...');

        // Test with different DocuSign webhook formats
        const webhookData = {
            envelopeId: 'test-envelope-123',
            status: 'completed',
            event: 'envelope-completed'
        };

        const response = await axios.post('http://localhost:4000/api/webhooks/docusign', webhookData, {
            headers: {
                'Content-Type': 'application/json',
                'X-DocuSign-Signature-1': 'test-signature'
            }
        });

        console.log('✅ Webhook test completed');
        console.log('Status:', response.status);
        console.log('Response:', response.data);

    } catch (error) {
        console.error('❌ Webhook test failed:', error.response?.data || error.message);
    }
}

testWebhookRawBody();
