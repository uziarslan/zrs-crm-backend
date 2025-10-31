const PurchaseOrder = require('../models/PurchaseOrder');
const Lead = require('../models/Lead');
const logger = require('../utils/logger');
const { sendNotificationEmail } = require('../utils/emailService');
const docusignService = require('../services/docusignService');

/**
 * @desc    DocuSign webhook handler
 * @route   POST /api/webhooks/docusign
 * @access  Public (webhook)
 */
exports.docusignWebhook = async (req, res, next) => {
    try {
        // Handle raw body parsing for DocuSign webhooks
        let event, data;

        // Handle DocuSign Connect JSON webhook format
        if (req.rawBody) {
            try {
                const rawData = JSON.parse(req.rawBody);
                logger.info('📋 DocuSign Connect JSON webhook detected');

                // Extract data from DocuSign Connect format
                event = rawData.event || 'envelope-updated';
                data = {
                    envelopeId: rawData.data?.envelopeId || rawData.data?.envelopeSummary?.envelopeId,
                    status: rawData.data?.envelopeSummary?.status,
                    event: rawData.event,
                    accountId: rawData.data?.accountId,
                    recipientId: rawData.data?.recipientId,
                    envelopeSummary: rawData.data?.envelopeSummary,
                    fullData: rawData
                };
            } catch (parseError) {
                logger.error('Failed to parse DocuSign Connect JSON:', parseError);
                event = 'envelope-updated';
                data = { rawBody: req.rawBody };
            }
        } else if (req.body.event && req.body.data) {
            event = req.body.event;
            data = req.body.data;
        } else if (req.body.envelopeId) {
            // DocuSign might send data directly in the body
            event = req.body.event || 'envelope-updated';
            data = req.body;
        } else if (req.body.envelopeSummary) {
            // DocuSign might send envelopeSummary directly
            event = req.body.event || 'envelope-updated';
            data = req.body;
        } else {
            // Fallback: use the entire body as data
            event = req.body.event || 'envelope-updated';
            data = req.body;
        }

        // Debug: Log the complete webhook request
        logger.info('🔍 COMPLETE WEBHOOK DATA DEBUG:');
        logger.info('📋 Headers:', JSON.stringify(req.headers, null, 2));
        logger.info('📋 Raw Body (req.rawBody):', req.rawBody ? req.rawBody.substring(0, 500) + '...' : 'No raw body');
        logger.info('📋 Parsed Body (req.body):', JSON.stringify(req.body, null, 2));
        logger.info('📋 Event:', event);
        logger.info('📋 Data Object:', JSON.stringify(data, null, 2));
        logger.info('📋 Data Type:', typeof data);
        logger.info('📋 Data Keys:', data ? Object.keys(data) : 'No data object');

        // Verify webhook authenticity (in production, verify HMAC signature)
        // const hmacSignature = req.headers['x-docusign-signature-1'];
        // if (!verifyDocuSignSignature(req.body, hmacSignature)) {
        //   return res.status(401).json({ success: false, message: 'Invalid signature' });
        // }

        // Extract envelope ID from multiple possible locations
        const envelopeId = data?.envelopeId ||
            data?.envelopeSummary?.envelopeId ||
            req.body.envelopeId ||
            data?.envelopeId;

        // Extract status from multiple possible locations
        const status = data?.envelopeSummary?.status ||
            data?.status ||
            data?.envelopeStatus ||
            req.body.status;

        // Debug: Log the raw status values
        logger.info('🔍 STATUS EXTRACTION DEBUG:');
        logger.info('📋 Envelope ID:', envelopeId);
        logger.info('📋 Data Status:', data?.status);
        logger.info('📋 Envelope Summary Status:', data?.envelopeSummary?.status);
        logger.info('📋 Final Status:', status);
        logger.info('📋 Event:', event);
        logger.info('📋 Data Envelope ID:', data?.envelopeId);
        logger.info('📋 Data Envelope Summary ID:', data?.envelopeSummary?.envelopeId);

        logger.info('DocuSign webhook processing:', {
            envelopeId,
            status,
            event,
            envelopeStatus: data?.envelopeSummary?.status,
            recipientStatus: data?.envelopeSummary?.recipients?.signers?.map(s => ({ email: s.email, status: s.status })),
            recipientCount: data?.envelopeSummary?.recipients?.signers?.length || 0
        });

        // Debug: Check if PurchaseOrder exists with this envelope ID
        const purchaseOrder = await PurchaseOrder.findOne({ docuSignEnvelopeId: envelopeId });
        let lead = purchaseOrder ? await Lead.findOne({ purchaseOrder: purchaseOrder._id }) : null;
        logger.info('Webhook purchase order lookup:', {
            envelopeId,
            purchaseOrderFound: !!purchaseOrder,
            leadFound: !!lead,
            leadId: lead?.leadId,
            docuSignStatus: purchaseOrder?.docuSignStatus
        });

        // Debug: Log the full webhook data structure
        logger.info('🔍 WEBHOOK DATA STRUCTURE DEBUG:');
        logger.info('📋 Envelope ID:', envelopeId);
        logger.info('📋 Status:', status);
        logger.info('📋 Event:', event);
        logger.info('📋 Envelope Summary Status:', data?.envelopeSummary?.status);
        logger.info('📋 Recipient Count:', data?.envelopeSummary?.recipients?.signers?.length || 0);
        logger.info('📋 Recipient Statuses:', data?.envelopeSummary?.recipients?.signers?.map(s => ({
            email: s.email,
            status: s.status,
            name: s.name
        })));
        logger.info('📋 Full Envelope Summary:', JSON.stringify(data?.envelopeSummary, null, 2));
        logger.info('📋 Full Recipients:', JSON.stringify(data?.envelopeSummary?.recipients, null, 2));

        if (!envelopeId) {
            logger.warn('🔍 NO ENVELOPE ID FOUND:');
            logger.warn('📋 Raw Body:', JSON.stringify(req.body, null, 2));
            logger.warn('📋 Data Object:', JSON.stringify(data, null, 2));
            logger.warn('📋 This might indicate:');
            logger.warn('   - DocuSign webhook not configured properly');
            logger.warn('   - Webhook data format is different than expected');
            logger.warn('   - DocuSign is not sending the expected data structure');
            return res.status(400).json({ success: false, message: 'Missing envelope ID' });
        }

        // Find PurchaseOrder with this envelope ID
        const po = await PurchaseOrder.findOne({ docuSignEnvelopeId: envelopeId })
            .populate('investorAllocations.investorId');

        // Find associated lead (reuse the lead variable from above)
        if (po && !lead) {
            lead = await Lead.findOne({ purchaseOrder: po._id })
                .populate('investor')
                .populate('createdBy');
        }

        if (po && lead) {
            // Handle Lead Purchase Agreement signing - only update DocuSign status
            const validStatuses = ['created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided', 'failed'];

            // Try multiple ways to get the status
            let docuSignStatus = status;
            if (!docuSignStatus) {
                docuSignStatus = data?.envelopeSummary?.status;
            }
            if (!docuSignStatus) {
                docuSignStatus = data?.status;
            }
            if (!docuSignStatus) {
                docuSignStatus = event; // Sometimes the event contains the status
            }

            docuSignStatus = docuSignStatus ? docuSignStatus.toLowerCase() : 'failed';

            // Check if any recipient has completed status
            const hasCompletedRecipient = data?.envelopeSummary?.recipients?.signers?.some(signer =>
                signer.status === 'completed' || signer.status === 'signed'
            );

            // Also check if the event indicates completion
            const isCompletionEvent = event === 'envelope-completed' || event === 'envelope-signed' || event === 'envelope-delivered';

            logger.info('🔍 STATUS PROCESSING DEBUG:');
            logger.info('📋 Envelope ID:', envelopeId);
            logger.info('📋 Lead ID:', lead.leadId);
            logger.info('📋 Current Status:', lead.docuSign?.status);
            logger.info('📋 Incoming Status:', docuSignStatus);
            logger.info('📋 Has Completed Recipient:', hasCompletedRecipient);
            logger.info('📋 Is Completion Event:', isCompletionEvent);
            logger.info('📋 Event:', event);
            logger.info('📋 Recipient Statuses:', data?.envelopeSummary?.recipients?.signers?.map(s => s.status));
            logger.info('📋 Status Detection Logic:');
            logger.info('   - docuSignStatus === "completed":', docuSignStatus === 'completed');
            logger.info('   - hasCompletedRecipient:', hasCompletedRecipient);
            logger.info('   - isCompletionEvent:', isCompletionEvent);
            logger.info('   - Will Update to Completed:', (docuSignStatus === 'completed' || hasCompletedRecipient || isCompletionEvent));

            // Check for envelope deletion first (highest priority)
            if (event === 'envelope-deleted') {
                // Reset approval status when envelope is deleted
                lead.approval.status = 'not_submitted';
                lead.approval.approvals = [];
                po.docuSignStatus = 'voided';
                po.status = 'draft'; // Reset PO status to draft
                po.docuSignError = 'Envelope deleted in DocuSign';
                po.docuSignFailedAt = new Date();
                // Clear stored documents since envelope was deleted
                po.docuSignDocuments = [];
                logger.info(`Lead ${lead.leadId} Purchase Agreement deleted - approval reset and documents cleared`);
            } else if (docuSignStatus === 'declined' || docuSignStatus === 'voided') {
                // Reset approval status if declined or voided
                lead.approval.status = 'not_submitted';
                lead.approval.approvals = [];
                po.docuSignStatus = docuSignStatus;
                po.docuSignError = null;
                po.docuSignFailedAt = new Date();
                logger.info(`Lead ${lead.leadId} Purchase Agreement ${docuSignStatus} - approval reset`);
            } else if (docuSignStatus === 'completed' || hasCompletedRecipient || isCompletionEvent) {
                po.docuSignStatus = 'completed';
                po.docuSignSignedAt = new Date();

                // Fetch and store the signed documents with base64 validation
                try {
                    logger.info(`Fetching signed documents for envelope ${envelopeId}`);
                    const signedDocuments = await docusignService.getSignedDocuments(envelopeId);

                    if (signedDocuments && signedDocuments.length > 0) {
                        // Validate and filter documents with valid base64 PDF content
                        const validDocuments = [];
                        for (const doc of signedDocuments) {
                            if (!doc.content || typeof doc.content !== 'string') {
                                logger.warn(`Document ${doc.documentId} (${doc.name}) has no content or invalid content type`);
                                continue;
                            }

                            // Validate base64 format and decode to check PDF header
                            try {
                                const cleanedBase64 = doc.content.replace(/^data:application\/pdf;base64,/, '');
                                const buffer = Buffer.from(cleanedBase64, 'base64');

                                // Check if decoded content starts with PDF magic number
                                if (buffer.length < 4 || buffer.slice(0, 4).toString() !== '%PDF') {
                                    logger.error(`Document ${doc.documentId} (${doc.name}) does not appear to be a valid PDF (missing %PDF header)`);
                                    continue;
                                }

                                validDocuments.push({
                                    documentId: doc.documentId,
                                    name: doc.name,
                                    fileType: doc.fileType || 'application/pdf',
                                    fileSize: doc.fileSize || buffer.length,
                                    content: cleanedBase64, // Store clean base64 without data URI prefix
                                    uri: doc.uri
                                });

                                logger.info(`✅ Validated and storing document ${doc.documentId}:`, {
                                    name: doc.name,
                                    contentLength: cleanedBase64.length,
                                    pdfSize: buffer.length,
                                    isValidPdf: true
                                });
                            } catch (validationError) {
                                logger.error(`Failed to validate document ${doc.documentId} (${doc.name}):`, validationError);
                                continue;
                            }
                        }

                        if (validDocuments.length > 0) {
                            po.docuSignDocuments = validDocuments;
                            logger.info(`✅ Stored ${validDocuments.length} validated signed documents for lead ${lead.leadId}`);
                        } else {
                            logger.warn(`No valid documents found after validation for envelope ${envelopeId}`);
                        }
                    } else {
                        logger.warn(`No signed documents found for envelope ${envelopeId}`);
                    }
                } catch (docError) {
                    logger.error(`Error fetching signed documents for envelope ${envelopeId}:`, docError);
                    // Don't fail the webhook if document fetching fails
                }

                logger.info(`Lead ${lead.leadId} Purchase Agreement signed by investor`);
            } else {
                // Update with valid status
                po.docuSignStatus = validStatuses.includes(docuSignStatus) ? docuSignStatus : 'sent';
                logger.info(`Lead ${lead.leadId} DocuSign status updated to: ${po.docuSignStatus}`);

                // If we're getting 'failed' status repeatedly, try to check the actual DocuSign status
                if (docuSignStatus === 'failed' && po.docuSignStatus === 'failed') {
                    logger.warn(`Lead ${lead.leadId} getting 'failed' status - this might indicate a webhook data issue`);
                    logger.warn('Consider checking DocuSign API directly for actual envelope status');
                }
            }

            // Save both PurchaseOrder and Lead
            await po.save();
            await lead.save();
            logger.info('🔍 DATABASE UPDATE DEBUG:');
            logger.info('📋 Lead ID:', lead.leadId);
            logger.info('📋 New Status:', po.docuSignStatus);
            logger.info('📋 Signed At:', po.docuSignSignedAt);
            logger.info('📋 Database Update: SUCCESS');
        } else {
            logger.info('🔍 NO MATCHING RECORD DEBUG:');
            logger.info('📋 Envelope ID:', envelopeId);
            logger.info('📋 Lead Found:', false);
            logger.info('📋 PO Found:', !!po);
            logger.info('📋 Searching for Lead with envelope ID:', envelopeId);
            logger.info('📋 This might indicate:');
            logger.info('   - Envelope ID mismatch');
            logger.info('   - Lead not found in database');
            logger.info('   - Different envelope ID format');
        }

        if (po) {
            // Normalize status/event
            const statusLower = (status || '').toLowerCase();
            const eventLower = (event || '').toLowerCase();

            if (statusLower) {
                po.docuSignStatus = statusLower;
            }

            if (eventLower === 'envelope-deleted' || eventLower === 'envelope-voided' || statusLower === 'voided') {
                // Envelope deleted/voided in DocuSign
                po.docuSignStatus = 'voided';
                po.status = 'draft';
                po.docuSignError = 'Envelope deleted/voided in DocuSign';
                po.docuSignFailedAt = new Date();
                po.docuSignSignedAt = null;
                po.docuSignDocuments = [];
                logger.info(`PO ${po.poId} reset to draft after DocuSign deletion/void.`);
            } else if (statusLower === 'completed') {
                po.status = 'signed';
                po.invoiceGenerated = false; // Ready for invoice generation
                logger.info(`PO ${po.poId} marked as signed after DocuSign completion`);
            } else if (statusLower === 'declined') {
                po.status = 'rejected';
                logger.info(`PO ${po.poId} marked as rejected after DocuSign ${statusLower}`);
            }

            await po.save();
        } else {
            // No Purchase Order found for this envelope
            logger.warn(`No PO found for DocuSign envelope ${envelopeId}`);
        }

        // Acknowledge webhook
        res.status(200).json({ success: true, message: 'Webhook processed' });
    } catch (error) {
        logger.error('DocuSign webhook error:', error);
        // Return 200 to prevent DocuSign from retrying
        res.status(200).json({ success: false, message: 'Error processing webhook' });
    }
};

/**
 * @desc    QuickBooks webhook handler (if applicable)
 * @route   POST /api/webhooks/quickbooks
 * @access  Public (webhook)
 */
exports.quickbooksWebhook = async (req, res, next) => {
    try {
        logger.info('QuickBooks webhook received:', req.body);

        // Process QuickBooks webhook
        // This could be for invoice payment notifications, etc.

        res.status(200).json({ success: true, message: 'Webhook processed' });
    } catch (error) {
        logger.error('QuickBooks webhook error:', error);
        res.status(200).json({ success: false, message: 'Error processing webhook' });
    }
};

/**
 * @desc    Microsoft Teams webhook handler (if applicable)
 * @route   POST /api/webhooks/teams
 * @access  Public (webhook)
 */
exports.teamsWebhook = async (req, res, next) => {
    try {
        logger.info('Teams webhook received:', req.body);

        // Process Teams webhook (e.g., meeting status changes)

        res.status(200).json({ success: true, message: 'Webhook processed' });
    } catch (error) {
        logger.error('Teams webhook error:', error);
        res.status(200).json({ success: false, message: 'Error processing webhook' });
    }
};

module.exports = exports;

