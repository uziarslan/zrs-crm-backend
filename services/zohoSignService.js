const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Zoho Sign Integration Service
 * Handles OAuth token management and request creation
 */
class ZohoSignService {
    constructor() {
        this.apiBaseUrl = (process.env.ZOHOSIGN_API_BASE_URL || 'https://sign.zoho.com/api/v1').replace(/\/$/, '');
        this.accountsBaseUrl = (process.env.ZOHOSIGN_ACCOUNTS_BASE_URL || 'https://accounts.zoho.com').replace(/\/$/, '');
        this.tokenCache = { accessToken: null, expiresAt: 0 };
        this.defaultNotes = process.env.ZOHOSIGN_INVESTOR_NOTES || this.getDefaultInvestorNotes();
    }

    getDefaultInvestorNotes() {
        return '<div>Dear Investor,<br/></div><div><br/></div><div>Welcome to ZRS Cars Trading, and thank you for initiating your onboarding process with us.<br/></div><div><br/></div><div>To proceed, please review and sign the attached Investor Agreement. This document formalizes your participation in our investment program and enables us to maintain full transparency regarding vehicle acquisitions, ROI tracking, and ongoing portfolio updates.<br/></div><div><br/></div><div>Kindly ensure all information is accurate before signing. Once the agreement is completed, our team will activate your investor profile and share the next steps directly to your registered email.<br/></div><div><br/></div><div>If you have any questions during the onboarding process, our support team is available to assist you at any time.<br/></div><div><br/></div><div>We appreciate your trust and look forward to a successful partnership.<br/></div><div><br/></div><div>Best regards,<br/></div><div>ZRS Cars Trading<br/></div>';
    }

    /**
     * Retrieve and cache Zoho OAuth access tokens
     */
    async getAccessToken(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.tokenCache.accessToken && now < this.tokenCache.expiresAt) {
            return this.tokenCache.accessToken;
        }

        const refreshToken = process.env.ZOHOSIGN_REFRESH_TOKEN;
        const clientId = process.env.ZOHOSIGN_CLIENT_ID;
        const clientSecret = process.env.ZOHOSIGN_CLIENT_SECRET;

        if (!refreshToken || !clientId || !clientSecret) {
            throw new Error('Zoho Sign credentials are not configured (ZOHOSIGN_REFRESH_TOKEN, ZOHOSIGN_CLIENT_ID, ZOHOSIGN_CLIENT_SECRET)');
        }

        try {
            const params = new URLSearchParams({
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: process.env.ZOHOSIGN_REDIRECT_URI || 'https://sign.zoho.com',
                grant_type: 'refresh_token'
            });

            const response = await axios.post(
                `${this.accountsBaseUrl}/oauth/v2/token`,
                params.toString(),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );

            if (!response.data?.access_token) {
                logger.error('Zoho Sign OAuth response missing access token:', response.data);
                throw new Error('Zoho Sign OAuth response missing access token');
            }

            const expiresIn = Number(response.data.expires_in) || 3600;
            this.tokenCache = {
                accessToken: response.data.access_token,
                expiresAt: now + Math.max((expiresIn - 60) * 1000, 5 * 60 * 1000)
            };

            return this.tokenCache.accessToken;
        } catch (error) {
            logger.error('Zoho Sign getAccessToken error:', error.response?.data || error.message);
            throw new Error('Failed to get Zoho Sign access token');
        }
    }

    /**
     * Normalize Zoho Sign statuses to the legacy signature status values stored in persistence
     */
    normalizeStatus(status) {
        if (!status) return undefined;
        const normalized = String(status).toLowerCase().trim();
        const map = {
            created: 'created',
            draft: 'created',
            sent: 'sent',
            inprogress: 'sent',
            'in-progress': 'sent',
            awaitingrecipient: 'sent',
            'waiting-for-signature': 'sent',
            viewed: 'delivered',
            delivered: 'delivered',
            signed: 'signed',
            completed: 'completed',
            finished: 'completed',
            declined: 'declined',
            rejected: 'declined',
            voided: 'voided',
            recalled: 'voided',
            revoked: 'voided',
            expired: 'voided',
            failed: 'failed',
            error: 'failed'
        };
        return map[normalized] || normalized || 'sent';
    }

    formatCurrency(value) {
        if (value === undefined || value === null || value === '') return '';
        const num = Number(value);
        if (Number.isNaN(num)) return String(value);
        return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    formatPercentageRange(min, max) {
        if (typeof min === 'number' && typeof max === 'number') {
            if (Math.abs(min - max) < 0.001) {
                return `${min}%`;
            }
            return `${min}% - ${max}%`;
        }
        if (typeof min === 'number') {
            return `${min}%`;
        }
        if (typeof max === 'number') {
            return `${max}%`;
        }
        return '';
    }

    buildFieldData({
        adminName,
        adminDesignation,
        investorName,
        investorEid,
        decidedPercentageMin,
        decidedPercentageMax,
        investmentAmount,
        date
    }) {
        const agreementDate = date ? new Date(date).toLocaleDateString() : new Date().toLocaleDateString();
        const decidedPercentage = this.formatPercentageRange(decidedPercentageMin, decidedPercentageMax);

        return {
            date: agreementDate,
            investment_amount: this.formatCurrency(investmentAmount),
            decided_percentage: decidedPercentage,
            admin_name: adminName || '',
            investor_name: investorName || '',
            investor_eid: investorEid || '',
            designation: adminDesignation || ''
        };
    }

    buildActions({ investorName, investorEmail }) {
        const actionId = process.env.ZOHOSIGN_INVESTOR_ACTION_ID;
        if (!actionId) {
            throw new Error('ZOHOSIGN_INVESTOR_ACTION_ID is not configured');
        }

        return [
            {
                recipient_name: investorName || 'Investor',
                recipient_email: investorEmail,
                action_id: actionId,
                action_type: 'SIGN',
                signing_order: 1,
                role: 'investor',
                verify_recipient: false,
                private_notes: ''
            }
        ];
    }

    /**
     * Create investor agreement via Zoho Sign template
     */
    async createInvestorAgreement(agreementData) {
        const templateId = process.env.ZOHOSIGN_INVESTOR_TEMPLATE_ID;
        if (!templateId) {
            throw new Error('ZOHOSIGN_INVESTOR_TEMPLATE_ID is not configured');
        }

        const accessToken = await this.getAccessToken();

        const payload = {
            templates: {
                request_name: `Investor Agreement - ${agreementData.investorName || 'Investor'}`,
                field_data: {
                    field_text_data: this.buildFieldData(agreementData),
                    field_boolean_data: {},
                    field_date_data: {},
                    field_radio_data: {},
                    field_checkboxgroup_data: {}
                },
                notes: this.defaultNotes,
                actions: this.buildActions(agreementData)
            }
        };

        try {
            const response = await axios.post(
                `${this.apiBaseUrl}/templates/${templateId}/createdocument`,
                payload,
                {
                    headers: {
                        Authorization: `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const requestInfo = response.data?.requests || response.data?.request || {};
            const requestId = requestInfo.request_id || response.data?.request_id;
            if (!requestId) {
                logger.error('Zoho Sign createInvestorAgreement response missing request_id:', response.data);
                throw new Error('Zoho Sign response missing request_id');
            }

            const normalizedStatus = this.normalizeStatus(requestInfo.request_status || response.data?.status || 'sent');

            return {
                requestId,
                status: normalizedStatus,
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('Zoho Sign createInvestorAgreement error:', error.response?.data || error.message);
            throw new Error('Failed to create investor agreement via Zoho Sign');
        }
    }

    /**
     * Create and send Lead Purchase Agreement via Zoho Sign template
     */
    async createLeadPurchaseAgreement(leadData) {
        const templateId = process.env.ZOHOSIGN_PURCHASE_AGREEMENT_TEMPLATE_ID;
        const actionId = process.env.ZOHOSIGN_PURCHASE_AGREEMENT_ACTION_ID;

        if (!templateId) {
            throw new Error('ZOHOSIGN_PURCHASE_AGREEMENT_TEMPLATE_ID is not configured');
        }
        if (!actionId) {
            throw new Error('ZOHOSIGN_PURCHASE_AGREEMENT_ACTION_ID is not configured');
        }

        const { leadId, investor, vehicleInfo } = leadData;
        if (!investor || !investor.email) {
            throw new Error('Investor email is required to send Zoho Sign purchase agreement');
        }

        const fieldTextData = this.buildLeadAgreementFieldData(leadData);

        // Build car name from make and model
        const carName = vehicleInfo?.make && vehicleInfo?.model
            ? `${vehicleInfo.make} ${vehicleInfo.model}`.trim()
            : '';

        // Build request name with car name if available
        const requestName = carName
            ? `Purchase Agreement ${leadId} - ${carName} - ZRS Cars Trading`
            : `Purchase Agreement ${leadId} - ZRS Cars Trading`;

        const payload = {
            templates: {
                request_name: requestName,
                field_data: {
                    field_text_data: fieldTextData,
                    field_boolean_data: {},
                    field_date_data: {},
                    field_radio_data: {},
                    field_checkboxgroup_data: {}
                },
                actions: [
                    {
                        recipient_name: investor.name || investor.email,
                        recipient_email: investor.email,
                        action_id: actionId,
                        action_type: 'SIGN',
                        signing_order: 1,
                        role: 'investor',
                        verify_recipient: false,
                        private_notes: ''
                    }
                ]
            }
        };

        try {
            const accessToken = await this.getAccessToken();
            const response = await axios.post(
                `${this.apiBaseUrl}/templates/${templateId}/createdocument`,
                payload,
                {
                    headers: {
                        Authorization: `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const requestInfo = response.data?.requests || response.data?.request || {};
            const requestId = requestInfo.request_id || response.data?.request_id;
            if (!requestId) {
                logger.error('Zoho Sign createLeadPurchaseAgreement response missing request_id:', response.data);
                throw new Error('Zoho Sign response missing request_id');
            }

            const normalizedStatus = this.normalizeStatus(requestInfo.request_status || response.data?.status || 'sent');

            return {
                requestId,
                status: normalizedStatus,
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('Zoho Sign createLeadPurchaseAgreement error:', error.response?.data || error.message);
            throw new Error('Failed to create Lead Purchase Agreement via Zoho Sign');
        }
    }

    /**
     * Create purchase order envelopes (one per investor allocation) via Zoho Sign
     */
    async createPurchaseOrderEnvelope(poData) {
        const { poId, investorAllocations, amount } = poData;

        if (!Array.isArray(investorAllocations) || investorAllocations.length === 0) {
            throw new Error('No investor allocations provided for Zoho Sign Purchase Order.');
        }

        const accessToken = await this.getAccessToken();
        const results = [];

        for (const allocation of investorAllocations) {
            if (!allocation?.investorEmail) {
                logger.warn(`Skipping Zoho Sign PO for investor without email: ${allocation?.investorName || allocation?.investorId}`);
                continue;
            }

            const safeName = (allocation.investorName || allocation.investorEmail || 'Investor').replace(/[^a-zA-Z0-9]+/g, '_');
            const pdfContent = this.generatePODocumentBase64({
                ...poData,
                amount: allocation.amount ?? amount,
                investorAllocations: [allocation]
            });

            const payload = {
                requests: {
                    request_name: `Purchase Order ${poId} - ${allocation.investorName || 'Investor'}`,
                    notes: process.env.ZOHOSIGN_PO_NOTES || this.defaultNotes,
                    actions: [
                        {
                            recipient_name: allocation.investorName || allocation.investorEmail || 'Investor',
                            recipient_email: allocation.investorEmail,
                            action_type: 'SIGN',
                            signing_order: 1,
                            verify_recipient: false,
                            private_notes: ''
                        }
                    ],
                    file_data: [
                        {
                            file_name: `PO_${poId}_${safeName}.pdf`,
                            file_content: pdfContent
                        }
                    ]
                }
            };

            try {
                const response = await axios.post(
                    `${this.apiBaseUrl}/requests`,
                    payload,
                    {
                        headers: {
                            Authorization: `Zoho-oauthtoken ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const requestInfo = response.data?.requests || response.data?.request || response.data;
                const requestId = requestInfo?.request_id || requestInfo?.requestId;
                if (!requestId) {
                    logger.error('Zoho Sign createPurchaseOrderEnvelope response missing request_id:', response.data);
                    throw new Error('Zoho Sign response missing request_id');
                }

                results.push({
                    investorId: allocation.investorId,
                    investorName: allocation.investorName,
                    investorEmail: allocation.investorEmail,
                    envelopeId: requestId,
                    status: this.normalizeStatus(requestInfo?.request_status || requestInfo?.status || 'sent'),
                    uri: requestInfo?.request_url
                });
            } catch (error) {
                logger.error(`Zoho Sign createPurchaseOrderEnvelope error for investor ${allocation?.investorEmail}:`, error.response?.data || error.message);
                throw new Error('Failed to send Purchase Order via Zoho Sign');
            }
        }

        if (results.length === 0) {
            throw new Error('No valid investors to send Zoho Sign envelopes to.');
        }

        return results;
    }

    /**
     * Fetch signed documents for a completed request
     * Returns an array compatible with the existing CRM storage schema
     */
    async getSignedDocuments(requestId, fallbackDocuments = []) {
        if (!requestId) return [];
        const accessToken = await this.getAccessToken();

        let metadataDocuments = [];
        try {
            const documentsResponse = await axios.get(
                `${this.apiBaseUrl}/requests/${requestId}/documents`,
                { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
            );

            logger.info(`Zoho Sign documents metadata for request ${requestId}:`, documentsResponse.data);
            metadataDocuments = documentsResponse.data?.documents || documentsResponse.data?.requests?.document_ids || [];
        } catch (error) {
            const errorData = error.response?.data;
            logger.warn(`Zoho Sign documents metadata fetch failed for request ${requestId}:`, errorData || error.message);
            if (errorData?.data) {
                logger.warn('Zoho Sign metadata error data:', errorData.data);
            }
            metadataDocuments = [];
        }

        if ((!metadataDocuments || metadataDocuments.length === 0) && Array.isArray(fallbackDocuments) && fallbackDocuments.length > 0) {
            logger.info(`Using fallback document metadata from webhook for request ${requestId}`);
            metadataDocuments = fallbackDocuments;
        }

        if (!metadataDocuments || metadataDocuments.length === 0) {
            logger.warn(`No documents found for Zoho Sign request ${requestId}`);
            return [];
        }

        const results = [];

        for (const doc of metadataDocuments) {
            const documentId = doc.document_id || doc.documentId || doc?.id || doc?.document?.document_id;
            if (!documentId) {
                logger.warn(`Skipping Zoho Sign document with missing ID for request ${requestId}:`, doc);
                continue;
            }

            try {
                const downloadResult = await this.downloadDocumentContent(accessToken, requestId, documentId);

                const buffer = Buffer.from(downloadResult.data);
                const base64 = buffer.toString('base64');
                results.push({
                    documentId,
                    name: doc.document_name || doc.name || `document-${documentId}.pdf`,
                    fileType: downloadResult.headers['content-type'] || 'application/pdf',
                    fileSize: Number(downloadResult.headers['content-length']) || buffer.length,
                    content: base64,
                    uri: doc.document_url || null
                });
            } catch (downloadError) {
                logger.error(`Failed to download Zoho Sign document ${documentId}:`, downloadError.response?.data || downloadError.message);
            }
        }

        return results;
    }

    async downloadDocumentContent(accessToken, requestId, documentId) {
        const headers = { Authorization: `Zoho-oauthtoken ${accessToken}` };
        const attempts = [
            `${this.apiBaseUrl}/requests/${requestId}/documents/${documentId}/download?include_audit_trail=true`,
            `${this.apiBaseUrl}/requests/${requestId}/download?include_audit_trail=true&document_ids=${documentId}`,
            `${this.apiBaseUrl}/requests/${requestId}/download?document_ids=${documentId}`
        ];

        let lastError = null;
        for (const url of attempts) {
            try {
                logger.info(`Attempting Zoho Sign document download via ${url}`);
                const response = await axios.get(url, {
                    headers,
                    responseType: 'arraybuffer'
                });
                if (response?.data) {
                    return response;
                }
            } catch (error) {
                lastError = error;
                logger.warn(`Zoho Sign document download attempt failed (${url}):`, error.response?.data || error.message);
            }
        }

        throw lastError || new Error('Unable to download Zoho Sign document');
    }

    buildLeadAgreementFieldData({ investor, vehicleInfo, purchaseOrder, priceAnalysis, jobCosting, allocation }) {
        const fmt = (v) => (v == null || v === '') ? 'N/A' : String(v);
        const fmtNumber = (v) => {
            if (v == null || v === '') return 'N/A';
            const num = Number(v);
            if (Number.isNaN(num)) return String(v);
            return num.toLocaleString('en-US');
        };
        const fmtPercentage = (v) => {
            if (v == null || v === '') return 'N/A';
            const num = Number(v);
            if (Number.isNaN(num)) return String(v);
            return `${num.toLocaleString('en-US')}%`;
        };
        const fmtMileage = (v) => {
            if (v == null || v === '') return 'N/A';
            const num = Number(v);
            if (Number.isNaN(num)) return String(v);
            return `${num.toLocaleString('en-US')} Km`;
        };

        const buyingPrice = Number(priceAnalysis?.purchasedFinalPrice || 0);
        const transferCost = Number(jobCosting?.transferCost || 0);
        const detailingCost = Number(jobCosting?.detailing_cost || 0);
        const agentCommission = Number(jobCosting?.agent_commision || 0);
        const carRecoveryCost = Number(jobCosting?.car_recovery_cost || 0);
        const inspectionCost = Number(jobCosting?.inspection_cost || 0);
        const totalCarPrice = buyingPrice + transferCost + detailingCost + agentCommission + carRecoveryCost + inspectionCost;

        const investmentAmount = allocation?.amount || 0;
        const investmentPercentage = allocation?.ownershipPercentage || allocation?.percentage || 0;

        return {
            purchase_order_no: fmt(purchaseOrder?.poId),
            date: fmt(new Date().toLocaleDateString()),
            investor_name: fmt(investor?.name),
            investor_eid: fmt(investor?.investorEid),
            prepared_by: fmt(purchaseOrder?.prepared_by),
            car_make: fmt(vehicleInfo?.make),
            car_model: fmt(vehicleInfo?.model),
            car_trim: fmt(vehicleInfo?.trim),
            car_color: fmt(vehicleInfo?.color),
            car_mileage: fmtMileage(vehicleInfo?.mileage),
            car_year: fmt(vehicleInfo?.year),
            car_region: fmt(vehicleInfo?.region),
            car_chassis: fmt(vehicleInfo?.vin),
            buying_price: fmtNumber(buyingPrice),
            transfer_cost_rta: fmtNumber(transferCost),
            detailing_cost: fmtNumber(detailingCost),
            agent_commision: fmtNumber(agentCommission),
            car_recovery_cost: fmtNumber(carRecoveryCost),
            inspection_cost: fmtNumber(inspectionCost),
            total_car_price: fmtNumber(totalCarPrice),
            investment_amount: fmtNumber(investmentAmount),
            investment_percentage: fmtPercentage(investmentPercentage)
        };
    }

    generatePODocumentBase64(poData) {
        const allocation = Array.isArray(poData.investorAllocations) ? poData.investorAllocations[0] : null;
        const investorName = allocation?.investorName || 'Investor';
        const investorEmail = allocation?.investorEmail || '';
        const investmentAmount = allocation?.amount || poData.amount || 0;

        const content = `
        PURCHASE ORDER
        PO ID: ${poData.poId || 'N/A'}
        Vehicle: ${poData.vehicleId || 'N/A'}
        Investor: ${investorName} (${investorEmail})

        Investment Amount: AED ${investmentAmount}

        This purchase order confirms the investor's commitment to fund the vehicle identified above.

        Please sign below to confirm your participation.

        Investor Signature: _______________________
        Date: _______________________
        `;

        return Buffer.from(content).toString('base64');
    }
}

module.exports = new ZohoSignService();

