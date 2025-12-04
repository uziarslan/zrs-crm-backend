const axios = require('axios');

async function testWebhookRawBody() {
    try {
        console.log('🧪 Testing Zoho Sign webhook with sample payload...');

        const webhookData = {
            requests: {
                request_id: 'test-request-123',
                request_status: 'completed',
                document_ids: [
                    {
                        document_id: 'doc-1',
                        document_name: 'Sample.pdf'
                    }
                ],
                actions: [
                    {
                        action_id: 'action-1',
                        recipient_email: 'test@example.com',
                        recipient_name: 'Test User',
                        action_status: 'SIGNED'
                    }
                ]
            },
            notifications: {
                activity: 'Document successfully signed',
                operation_type: 'RequestSigningSuccess'
            }
        };

        const response = await axios.post('http://localhost:4000/api/webhooks/zohosign', webhookData, {
            headers: {
                'Content-Type': 'application/json'
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
