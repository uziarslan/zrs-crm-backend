const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function buildConsentUrl(customRedirectUri = null) {
    const clientId = process.env.DOCUSIGN_INTEGRATOR_KEY || process.env.DOCUSIGN_CLIENT_ID;
    const env = (process.env.DOCUSIGN_ENV || 'demo').toLowerCase();
    const host = (env === 'prod' || env === 'production') ? 'account.docusign.com' : 'account-d.docusign.com';

    if (!clientId) {
        console.error('❌ Missing DOCUSIGN_INTEGRATOR_KEY (or DOCUSIGN_CLIENT_ID) in environment');
        process.exit(1);
    }

    // Get redirect URI - command line argument takes priority, then env, then default to Google
    let redirect = customRedirectUri || process.env.DOCUSIGN_REDIRECT_URI || 'https://www.google.com';

    console.log('✅ Using redirect URI:', redirect);
    console.log('');

    const params = new URLSearchParams({
        response_type: 'code',
        scope: 'signature impersonation',
        client_id: String(clientId),
        redirect_uri: String(redirect),
    });

    const url = `https://${host}/oauth/auth?${params.toString()}`;

    console.log('\n🎯 DocuSign One-Time Consent URL:\n');
    console.log(url);
    console.log('\n📝 Instructions:');
    console.log('1. Copy the URL above');
    console.log('2. Open it in your browser');
    console.log('3. Log in with your DocuSign account');
    console.log('4. Grant consent to the application');
    console.log('5. After consent, you\'ll be redirected (you can close that page)\n');

    return url;
}

// Check if redirect URI was passed as command line argument
const customRedirectUri = process.argv[2] || null;

if (customRedirectUri) {
    console.log('✅ Using redirect URI from command line:', customRedirectUri);
    console.log('');
}

buildConsentUrl(customRedirectUri);

