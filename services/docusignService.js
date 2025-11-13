const docusign = require('docusign-esign');
const logger = require('../utils/logger');

/**
 * DocuSign Integration Service
 * Handles document generation, signing, and webhook processing
 */

class DocuSignService {
    constructor() {
        this.apiClient = new docusign.ApiClient();
        this.apiClient.setBasePath(process.env.DOCUSIGN_BASE_URI || 'https://demo.docusign.net/restapi');
    }

    /**
     * Send invoice to investor via DocuSign (no recipient signature required).
     * Uses a DocuSign template configured for invoices.
     * Expects env DOCUSIGN_INVOICE_TEMPLATE_ID and investor role "investor".
     */
    async createInvoiceEnvelope(invoiceData) {
        try {
            const accessToken = await this.getAccessToken();
            this.apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

            const envelopesApi = new docusign.EnvelopesApi(this.apiClient);
            const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
            const templateId = process.env.DOCUSIGN_INVOICE_TEMPLATE_ID;

            if (!templateId) {
                throw new Error('DOCUSIGN_INVOICE_TEMPLATE_ID not configured');
            }

            // Template role for investor recipient (no signing needed if template is set to CC/viewer)
            const templateRole = {
                roleName: 'investor',
                name: invoiceData.investorName || 'Investor',
                email: invoiceData.investorEmail,
                tabs: {
                    textTabs: [
                        { tabLabel: 'invoice_no', value: String(invoiceData.invoiceNo || '') },
                        { tabLabel: 'date', value: String(invoiceData.date || '') },
                        { tabLabel: 'investor_name', value: String(invoiceData.investorName || '') },
                        { tabLabel: 'prepared_by', value: String(invoiceData.preparedBy || '') },
                        { tabLabel: 'reference_po_no', value: String(invoiceData.referencePoNo || '') },

                        // Vehicle
                        { tabLabel: 'car_make', value: String(invoiceData.carMake || '') },
                        { tabLabel: 'car_model', value: String(invoiceData.carModel || '') },
                        { tabLabel: 'trim', value: String(invoiceData.trim || '') },
                        { tabLabel: 'year_model', value: String(invoiceData.yearModel || '') },
                        { tabLabel: 'chassis_no', value: String(invoiceData.chassisNo || '') },

                        // Costs
                        { tabLabel: 'buying_price', value: String(invoiceData.buyingPrice ?? '') },
                        { tabLabel: 'transfer_cost', value: String(invoiceData.transferCost ?? '') },
                        { tabLabel: 'detailing_inspection_cost', value: String(invoiceData.detailingInspectionCost ?? '') },
                        { tabLabel: 'other_charges', value: String(invoiceData.otherCharges ?? '') },
                        { tabLabel: 'total_amount_payable', value: String(invoiceData.totalAmountPayable ?? '') },

                        // Payment
                        { tabLabel: 'mode_of_payment', value: String(invoiceData.modeOfPayment || '') },
                        { tabLabel: 'payment_received_by', value: String(invoiceData.paymentReceivedBy || '') },
                        { tabLabel: 'date_of_payment', value: String(invoiceData.dateOfPayment || '') },
                    ]
                }
            };

            const envelopeDefinition = new docusign.EnvelopeDefinition();
            envelopeDefinition.templateId = templateId;
            envelopeDefinition.templateRoles = [templateRole];
            // Set to "created/sent" depending on whether you want to email immediately
            envelopeDefinition.status = 'sent';

            const envelopeSummary = await envelopesApi.createEnvelope(accountId, { envelopeDefinition });
            return envelopeSummary;
        } catch (error) {
            logger.error('DocuSign create invoice envelope error:', error);
            throw new Error('Failed to send invoice via DocuSign');
        }
    }

    /**
     * Get DocuSign access token using JWT
     */
    async getAccessToken() {
        try {
            // Create a fresh API client for token request
            const tokenApiClient = new docusign.ApiClient();
            tokenApiClient.setBasePath((process.env.DOCUSIGN_BASE_URI || 'https://demo.docusign.net') + '/restapi');

            // Handle private key format - ensure proper line breaks
            let privateKey = process.env.DOCUSIGN_PRIVATE_KEY;

            // If the key is stored as a string with \n, convert them to actual newlines
            if (privateKey.includes('\\n')) {
                privateKey = privateKey.replace(/\\n/g, '\n');
            }

            // Ensure the key has proper BEGIN/END markers
            if (!privateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
                privateKey = `-----BEGIN RSA PRIVATE KEY-----\n${privateKey}\n-----END RSA PRIVATE KEY-----`;
            }

            const results = await tokenApiClient.requestJWTUserToken(
                process.env.DOCUSIGN_INTEGRATOR_KEY,
                process.env.DOCUSIGN_USER_ID,
                ['signature', 'impersonation'],
                privateKey,
                3600 // 1 hour
            );

            return results.body.access_token;
        } catch (error) {
            logger.error('DocuSign get access token error:', error);
            logger.error('Private key format check:', {
                hasBeginMarker: process.env.DOCUSIGN_PRIVATE_KEY?.includes('-----BEGIN'),
                hasEndMarker: process.env.DOCUSIGN_PRIVATE_KEY?.includes('-----END'),
                keyLength: process.env.DOCUSIGN_PRIVATE_KEY?.length
            });
            throw new Error('Failed to get DocuSign access token');
        }
    }

    /**
     * Create and send Purchase Order envelope
     * @param {Object} poData - Purchase Order data
     * @returns {Object} Envelope info
     */
    async createPurchaseOrderEnvelope(poData) {
        try {
            const { poId, vehicleId, investorAllocations, amount } = poData;

            if (!Array.isArray(investorAllocations) || investorAllocations.length === 0) {
                throw new Error('No investor allocations provided for DocuSign PO.');
            }

            // Get access token
            const accessToken = await this.getAccessToken();
            this.apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

            const envelopesApi = new docusign.EnvelopesApi(this.apiClient);
            const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

            const results = [];

            for (const allocation of investorAllocations) {
                if (!allocation?.investorEmail) {
                    logger.warn(`Skipping DocuSign PO for investor without email: ${allocation?.investorName || allocation?.investorId}`);
                    continue;
                }

                const safeName = (allocation.investorName || allocation.investorEmail || 'Investor').replace(/[^a-zA-Z0-9]+/g, '_');

                // Create envelope definition for this investor
                const envelope = new docusign.EnvelopeDefinition();
                envelope.emailSubject = `Purchase Order ${poId} - ${allocation.investorName || 'Investor'}`;
                envelope.status = 'sent';

                // Create document (in production, generate actual PDF)
                const doc = new docusign.Document();
                doc.documentBase64 = this.generatePODocumentBase64({
                    ...poData,
                    amount: allocation.amount ?? amount,
                    investorAllocations: [allocation]
                });
                doc.name = `PO_${poId}_${safeName}.pdf`;
                doc.fileExtension = 'pdf';
                doc.documentId = '1';
                envelope.documents = [doc];

                // Configure signer for this investor
                const signer = new docusign.Signer();
                signer.email = allocation.investorEmail;
                signer.name = allocation.investorName || allocation.investorEmail || 'Investor';
                signer.recipientId = '1';
                signer.routingOrder = '1';

                const signHere = new docusign.SignHere();
                signHere.documentId = '1';
                signHere.pageNumber = '1';
                signHere.xPosition = '100';
                signHere.yPosition = '200';

                signer.tabs = { signHereTabs: [signHere] };
                envelope.recipients = { signers: [signer] };

                const result = await envelopesApi.createEnvelope(accountId, { envelopeDefinition: envelope });

                logger.info(`DocuSign envelope created for PO ${poId} (Investor: ${allocation.investorName || allocation.investorEmail}): ${result.envelopeId}`);

                results.push({
                    investorId: allocation.investorId,
                    investorName: allocation.investorName,
                    investorEmail: allocation.investorEmail,
                    envelopeId: result.envelopeId,
                    status: result.status,
                    uri: result.uri
                });
            }

            if (results.length === 0) {
                throw new Error('No valid investors to send DocuSign envelopes to.');
            }

            return results;
        } catch (error) {
            logger.error('DocuSign create PO envelope error:', error);
            throw new Error('Failed to create DocuSign envelope');
        }
    }

    /**
     * Create and send Lead Purchase Agreement envelope using template
     * @param {Object} leadData - Lead data with investor info
     * @returns {Object} Envelope info
     */
    async createLeadPurchaseAgreement(leadData) {
        try {
            const { leadId, investor, priceAnalysis, vehicleInfo, contactInfo, purchaseOrder, allocation } = leadData;

            if (!investor || !investor.email) {
                throw new Error('Investor email is required to send DocuSign purchase agreement');
            }

            // Debug logging
            logger.info('DocuSign createLeadPurchaseAgreement called with:', {
                leadId,
                investor: investor ? { name: investor.name, email: investor.email, _id: investor._id } : null,
                hasPriceAnalysis: !!priceAnalysis,
                hasVehicleInfo: !!vehicleInfo,
                hasContactInfo: !!contactInfo,
                allocation: allocation ? {
                    investorId: allocation.investorId,
                    percentage: allocation.percentage,
                    amount: allocation.amount
                } : null
            });

            // Get access token
            const accessToken = await this.getAccessToken();

            // Create a fresh API client for this request
            const apiClient = new docusign.ApiClient();
            // Use sandbox for development to avoid envelope limits
            const baseUri = process.env.NODE_ENV === 'development'
                ? 'https://demo.docusign.net'
                : (process.env.DOCUSIGN_BASE_URI || 'https://demo.docusign.net');
            apiClient.setBasePath(baseUri + '/restapi');
            apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

            const envelopesApi = new docusign.EnvelopesApi(apiClient);
            const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

            // Create envelope definition using template
            const envelope = new docusign.EnvelopeDefinition();
            envelope.emailSubject = `Purchase Agreement ${leadId} - ZRS Cars Trading`;
            envelope.status = 'sent';

            // Use template ID from environment variables
            envelope.templateId = process.env.DOCUSIGN_PURCHASE_AGREEMENT_TEMPLATE_ID;

            logger.info('DocuSign envelope configuration:', {
                templateId: envelope.templateId,
                accountId: accountId,
                basePath: apiClient.getBasePath(),
                recipientEmail: investor.email,
                recipientName: investor.name,
                roleName: 'investor',
                signingType: 'remote' // Email delivery enabled by removing clientUserId
            });

            // Validate template ID
            if (!envelope.templateId) {
                throw new Error('DOCUSIGN_PURCHASE_AGREEMENT_TEMPLATE_ID is not set in environment variables');
            }

            // Create template role for investor
            const templateRole = new docusign.TemplateRole();
            templateRole.email = investor.email;
            templateRole.name = investor.name;
            templateRole.roleName = 'investor'; // This should match the role name in your DocuSign template
            // Note: clientUserId is removed to enable remote signing (email delivery)

            // Add template variables (custom fields in your DocuSign template)
            // Map provided PO fields to template tabs exactly as requested
            const fmt = (v) => (v == null || v === '') ? 'N/A' : String(v);
            templateRole.tabs = {
                textTabs: [
                    // From Lead
                    { tabLabel: 'buying_price', value: fmt(priceAnalysis?.purchasedFinalPrice) },
                    { tabLabel: 'car_chassis', value: fmt(vehicleInfo?.vin) },
                    { tabLabel: 'car_color', value: fmt(vehicleInfo?.color) },
                    { tabLabel: 'car_make', value: fmt(vehicleInfo?.make) },
                    { tabLabel: 'car_mileage', value: fmt(vehicleInfo?.mileage) },
                    { tabLabel: 'car_model', value: fmt(vehicleInfo?.model) },
                    { tabLabel: 'car_region', value: fmt(vehicleInfo?.region) },
                    { tabLabel: 'car_trim', value: fmt(vehicleInfo?.trim) },
                    { tabLabel: 'car_year', value: fmt(vehicleInfo?.year) },
                    { tabLabel: 'eid_passport', value: fmt(contactInfo?.passportOrEmiratesId) },
                    { tabLabel: 'investor_name', value: fmt(investor?.name) },

                    // From PurchaseOrder
                    { tabLabel: 'agent_commision', value: fmt(purchaseOrder?.agent_commision) },
                    { tabLabel: 'car_recovery_cost', value: fmt(purchaseOrder?.car_recovery_cost) },
                    { tabLabel: 'detailing_inspection_cost', value: fmt(purchaseOrder?.detailing_inspection_cost) },
                    { tabLabel: 'other_charges', value: fmt(purchaseOrder?.other_charges) },
                    { tabLabel: 'prepared_by', value: fmt(purchaseOrder?.prepared_by) },
                    { tabLabel: 'purchase_order_no', value: fmt(purchaseOrder?.poId) },
                    { tabLabel: 'total_investment_amount', value: fmt(purchaseOrder?.total_investment) },
                    { tabLabel: 'transfer_cost_rta', value: fmt(purchaseOrder?.transferCost) },

                    // Date
                    { tabLabel: 'date', value: fmt(new Date().toLocaleDateString()) },

                    // Allocation Specific (optional tabs in template)
                    { tabLabel: 'investor_allocation_percentage', value: fmt(allocation?.percentage) },
                    { tabLabel: 'investor_allocation_amount', value: fmt(allocation?.amount) }
                ]
            };

            envelope.templateRoles = [templateRole];


            // Create envelope
            const result = await envelopesApi.createEnvelope(accountId, { envelopeDefinition: envelope });

            logger.info(`DocuSign Lead Purchase Agreement created using template for ${leadId}: ${result.envelopeId}`);

            return {
                envelopeId: result.envelopeId,
                status: result.status,
                uri: result.uri
            };
        } catch (error) {
            logger.error('DocuSign create Lead Purchase Agreement error:', error);
            logger.error('Error details:', {
                message: error.message,
                status: error.status,
                response: error.response?.text,
                leadData: {
                    leadId: leadData.leadId,
                    investor: leadData.investor ? { name: leadData.investor.name, email: leadData.investor.email } : null,
                    templateId: process.env.DOCUSIGN_PURCHASE_AGREEMENT_TEMPLATE_ID
                }
            });

            throw new Error('Failed to create Lead Purchase Agreement');
        }
    }

    /**
     * Create consignment contract envelope
     * @param {Object} contractData - Contract data
     * @returns {Object} Envelope info
     */
    async createConsignmentContract(contractData) {
        try {
            const { vehicleId, ownerEmail, ownerName, commissionPercentage } = contractData;

            const accessToken = await this.getAccessToken();
            this.apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

            const envelopesApi = new docusign.EnvelopesApi(this.apiClient);
            const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

            const envelope = new docusign.EnvelopeDefinition();
            envelope.emailSubject = `Consignment Contract ${vehicleId} - ZRS Cars Trading`;
            envelope.status = 'sent';

            // Create document
            const doc = new docusign.Document();
            doc.documentBase64 = this.generateConsignmentContractBase64(contractData);
            doc.name = `Consignment_${vehicleId}.pdf`;
            doc.fileExtension = 'pdf';
            doc.documentId = '1';
            envelope.documents = [doc];

            // Add signer
            const signer = new docusign.Signer();
            signer.email = ownerEmail;
            signer.name = ownerName;
            signer.recipientId = '1';

            const signHere = new docusign.SignHere();
            signHere.documentId = '1';
            signHere.pageNumber = '1';
            signHere.xPosition = '100';
            signHere.yPosition = '500';

            signer.tabs = { signHereTabs: [signHere] };
            envelope.recipients = { signers: [signer] };

            const result = await envelopesApi.createEnvelope(accountId, { envelopeDefinition: envelope });

            logger.info(`DocuSign consignment contract created for ${vehicleId}: ${result.envelopeId}`);

            return {
                envelopeId: result.envelopeId,
                status: result.status
            };
        } catch (error) {
            logger.error('DocuSign create consignment contract error:', error);
            throw new Error('Failed to create consignment contract');
        }
    }

    /**
     * Get envelope status
     */
    async getEnvelopeStatus(envelopeId) {
        try {
            const accessToken = await this.getAccessToken();
            this.apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

            const envelopesApi = new docusign.EnvelopesApi(this.apiClient);
            const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

            const envelope = await envelopesApi.getEnvelope(accountId, envelopeId);

            return {
                envelopeId: envelope.envelopeId,
                status: envelope.status,
                completedDateTime: envelope.completedDateTime
            };
        } catch (error) {
            logger.error('DocuSign get envelope status error:', error);
            throw new Error('Failed to get envelope status');
        }
    }

    /**
     * Get signed documents from completed envelope
     */
    async getSignedDocuments(envelopeId) {
        try {
            const accessToken = await this.getAccessToken();

            // Create a fresh API client for this request
            const apiClient = new docusign.ApiClient();
            // Use sandbox for development to avoid envelope limits
            const baseUri = process.env.NODE_ENV === 'development'
                ? 'https://demo.docusign.net'
                : (process.env.DOCUSIGN_BASE_URI || 'https://demo.docusign.net');
            apiClient.setBasePath(baseUri + '/restapi');
            apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

            const envelopesApi = new docusign.EnvelopesApi(apiClient);
            const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

            // Get envelope documents
            const documents = await envelopesApi.listDocuments(accountId, envelopeId);

            const signedDocuments = [];

            if (documents.envelopeDocuments) {
                for (const doc of documents.envelopeDocuments) {
                    try {
                        // Get the document content
                        const documentContent = await envelopesApi.getDocument(
                            accountId,
                            envelopeId,
                            doc.documentId
                        );

                        logger.info(`Document content type for ${doc.documentId}:`, typeof documentContent);
                        logger.info(`Document content length:`, documentContent?.length || 'undefined');

                        // Convert to base64 across possible SDK return types
                        let base64Content;
                        try {
                            if (Buffer.isBuffer(documentContent)) {
                                // Node Buffer
                                base64Content = documentContent.toString('base64');
                            } else if (documentContent instanceof Uint8Array) {
                                // Uint8Array / ArrayBuffer views
                                base64Content = Buffer.from(documentContent).toString('base64');
                            } else if (
                                documentContent &&
                                typeof documentContent.byteLength === 'number' &&
                                typeof documentContent.slice === 'function'
                            ) {
                                // ArrayBuffer
                                base64Content = Buffer.from(new Uint8Array(documentContent)).toString('base64');
                            } else if (typeof documentContent === 'string') {
                                // Binary string -> base64
                                base64Content = Buffer.from(documentContent, 'binary').toString('base64');
                            } else {
                                logger.error(`Unexpected document content type for ${doc.documentId}:`, typeof documentContent);
                            }
                        } catch (convErr) {
                            logger.error(`Failed to convert document ${doc.documentId} to base64:`, convErr);
                        }

                        if (!base64Content) {
                            logger.error(`No content retrieved for document ${doc.documentId}`);
                            continue; // Skip this document
                        }

                        signedDocuments.push({
                            documentId: doc.documentId,
                            name: doc.name || `document_${doc.documentId}.pdf`,
                            fileType: 'application/pdf',
                            fileSize: base64Content.length * 0.75, // Approximate size (base64 is ~33% larger)
                            content: base64Content,
                            uri: doc.uri
                        });

                        logger.info(`Fetched signed document: ${doc.name || doc.documentId} (${base64Content.length} chars)`);
                    } catch (docError) {
                        logger.error(`Error fetching document ${doc.documentId}:`, docError);
                    }
                }
            }

            logger.info(`Retrieved ${signedDocuments.length} signed documents for envelope ${envelopeId}`);
            return signedDocuments;

        } catch (error) {
            logger.error('DocuSign get signed documents error:', error);
            throw new Error('Failed to get signed documents');
        }
    }

    /**
     * Generate PO document as base64 (placeholder - in production use actual PDF generator)
     */
    generatePODocumentBase64(poData) {
        // TODO: In production, use a PDF library like PDFKit or html-pdf to generate actual PDF
        // For now, return a simple base64 encoded string
        const content = `
      PURCHASE ORDER: ${poData.poId}
      Vehicle: ${poData.vehicleId}
      Amount: AED ${poData.amount}
      
      Investor Allocations:
      ${poData.investorAllocations.map(a => `${a.investorName}: AED ${a.amount} (${a.percentage}%)`).join('\n')}
      
      Please sign below to confirm your investment.
    `;

        return Buffer.from(content).toString('base64');
    }

    /**
     * Generate Lead Purchase Agreement as base64 (placeholder)
     */
    generateLeadPurchaseAgreementBase64(leadData) {
        const { leadId, investor, priceAnalysis, vehicleInfo, contactInfo } = leadData;

        const content = `
      PURCHASE AGREEMENT
      Lead ID: ${leadId}
      Date: ${new Date().toLocaleDateString()}
      
      VEHICLE DETAILS:
      Make: ${vehicleInfo?.make || 'N/A'}
      Model: ${vehicleInfo?.model || 'N/A'}
      Year: ${vehicleInfo?.year || 'N/A'}
      Mileage: ${vehicleInfo?.mileage ? vehicleInfo.mileage.toLocaleString() : 'N/A'} km
      VIN: ${vehicleInfo?.vin || 'N/A'}
      
      SELLER INFORMATION:
      Name: ${contactInfo?.name || 'N/A'}
      Phone: ${contactInfo?.phone || 'N/A'}
      Email: ${contactInfo?.email || 'N/A'}
      
      INVESTOR INFORMATION:
      Name: ${investor?.name || 'N/A'}
      Email: ${investor?.email || 'N/A'}
      
      PRICE ANALYSIS:
      Asking Price: AED ${vehicleInfo?.askingPrice?.toLocaleString() || 'N/A'}
      Minimum Selling Price: AED ${priceAnalysis?.minSellingPrice?.toLocaleString() || 'N/A'}
      Maximum Selling Price: AED ${priceAnalysis?.maxSellingPrice?.toLocaleString() || 'N/A'}
      Purchase Final Price: AED ${priceAnalysis?.purchasedFinalPrice?.toLocaleString() || 'N/A'}
      
      TERMS AND CONDITIONS:
      1. The investor agrees to fund the purchase of the above vehicle
      2. ZRS Cars Trading will handle all negotiations and documentation
      3. Upon successful purchase, the vehicle will be added to inventory
      4. The investor will receive their allocated percentage of profits upon sale
      5. All parties agree to the terms outlined in this agreement
      
      By signing below, the investor confirms their agreement to fund this vehicle purchase.
      
      Investor Signature: _______________________
      Date: _______________________
      
      ZRS Cars Trading Representative: _______________________
      Date: _______________________
    `;

        return Buffer.from(content).toString('base64');
    }

    /**
     * Generate consignment contract as base64 (placeholder)
     */
    generateConsignmentContractBase64(contractData) {
        const content = `
      CONSIGNMENT CONTRACT
      Vehicle ID: ${contractData.vehicleId}
      Owner: ${contractData.ownerName}
      Commission: ${contractData.commissionPercentage}%
      
      Terms and Conditions:
      1. ZRS Cars Trading will sell the vehicle on behalf of the owner
      2. Commission will be deducted from the sale price
      3. Owner will receive payment within 7 business days of sale
      
      Signature: _______________________
    `;

        return Buffer.from(content).toString('base64');
    }
}

module.exports = new DocuSignService();

