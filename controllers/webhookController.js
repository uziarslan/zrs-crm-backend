const PurchaseOrder = require('../models/PurchaseOrder');
const Lead = require('../models/Lead');
const InvestorAgreement = require('../models/InvestorAgreement');
const Investor = require('../models/Investor');
const logger = require('../utils/logger');
const { sendNotificationEmail } = require('../utils/emailService');
const { sendMailtrapEmail } = require('../services/mailtrapService');
const { generateInviteToken } = require('../utils/otpHelper');
const zohoSignService = require('../services/zohoSignService');

const handleSignatureWebhook = async (req, res, next) => {
    const providerLabel = req.__provider || 'Zoho Sign';
    const signatureService = req.__signatureService || zohoSignService;
    try {
        // Handle webhook body parsing (Zoho Sign sends JSON)
        let event, data;

        // Handle payload from Zoho Sign normalization helper
        if (req.rawBody) {
            try {
                const rawData = JSON.parse(req.rawBody);
                logger.info(`📋 ${providerLabel} webhook payload parsed from raw body`);

                // Extract data from payload format
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
                logger.error(`Failed to parse ${providerLabel} raw body JSON:`, parseError);
                event = 'envelope-updated';
                data = { rawBody: req.rawBody };
            }
        } else if (req.body.event && req.body.data) {
            event = req.body.event;
            data = req.body.data;
        } else if (req.body.envelopeId) {
            // Zoho Sign might send data directly in the body
            event = req.body.event || 'envelope-updated';
            data = req.body;
        } else if (req.body.envelopeSummary) {
            // Zoho Sign might send envelopeSummary directly
            event = req.body.event || 'envelope-updated';
            data = req.body;
        } else {
            // Fallback: use the entire body as data
            event = req.body.event || 'envelope-updated';
            data = req.body;
        }

        // Reduced logging to prevent memory issues
        logger.info(`📋 ${providerLabel} webhook received:`, {
            event: event,
            hasEnvelopeId: !!(data?.envelopeId || data?.envelopeSummary?.envelopeId),
            hasStatus: !!(data?.envelopeSummary?.status || data?.status)
        });

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

        logger.info(`📋 ${providerLabel} webhook processing:`, {
            envelopeId,
            status: status || data?.envelopeSummary?.status || data?.status,
            event
        });

        if (!envelopeId) {
            logger.warn('🔍 NO ENVELOPE ID FOUND:');
            logger.warn('📋 Raw Body:', JSON.stringify(req.body, null, 2));
            logger.warn('📋 Data Object:', JSON.stringify(data, null, 2));
            logger.warn('📋 This might indicate:');
            logger.warn(`   - ${providerLabel} webhook not configured properly`);
            logger.warn('   - Webhook data format is different than expected');
            logger.warn(`   - ${providerLabel} is not sending the expected data structure`);
            return res.status(400).json({ success: false, message: 'Missing envelope ID' });
        }

        // Check for InvestorAgreement first
        const investorAgreement = await InvestorAgreement.findOne({ envelopeId })
            .populate('investorId')
            .populate('adminId');

        // Find PurchaseOrder with this envelope ID (top-level or per-investor envelope)
        const po = await PurchaseOrder.findOne({
            $or: [
                { docuSignEnvelopeId: envelopeId },
                { 'docuSignEnvelopes.envelopeId': envelopeId },
                { 'investorAllocations.docuSignEnvelopeId': envelopeId }
            ]
        })
            .populate('investorAllocations.investorId');

        let lead = null;
        if (po) {
            lead = await Lead.findOne({ purchaseOrder: po._id })
                .populate('investorAllocations.investorId', 'name email')
                .populate('createdBy');
        }

        logger.info('📋 Webhook lookup:', {
            envelopeId,
            investorAgreementFound: !!investorAgreement,
            purchaseOrderFound: !!po,
            leadFound: !!lead
        });

        if (po && lead) {
            // Handle Lead Purchase Agreement signing - only update Zoho Sign status
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

            let matchingEnvelope = po.docuSignEnvelopes?.find(env => String(env.envelopeId) === String(envelopeId));
            let matchingAllocation = po.investorAllocations?.find(allocation => {
                const allocationInvestorId = allocation.investorId?._id || allocation.investorId;
                const matchesEnvelope = matchingEnvelope && allocationInvestorId && matchingEnvelope.investorId && String(allocationInvestorId) === String(matchingEnvelope.investorId);
                return String(allocation.docuSignEnvelopeId) === String(envelopeId) || matchesEnvelope;
            });
            const statusTimestamp = new Date();

            const applyStatusToMatching = (status) => {
                const normalized = (status || 'sent').toLowerCase();

                if (!Array.isArray(po.docuSignEnvelopes)) {
                    po.docuSignEnvelopes = [];
                }

                if (!matchingEnvelope) {
                    const inferredInvestorId = matchingAllocation?.investorId?._id || matchingAllocation?.investorId || null;
                    const inferredInvestorName = matchingAllocation?.investorId?.name || matchingAllocation?.investorName;
                    const inferredInvestorEmail = matchingAllocation?.investorId?.email || matchingAllocation?.investorEmail;
                    const newEnvelopeRecord = {
                        investorId: inferredInvestorId,
                        investorName: inferredInvestorName,
                        investorEmail: inferredInvestorEmail,
                        envelopeId,
                        status: normalized,
                        sentAt: undefined,
                        completedAt: undefined
                    };
                    po.docuSignEnvelopes.push(newEnvelopeRecord);
                    matchingEnvelope = newEnvelopeRecord;
                }

                if (!matchingAllocation && matchingEnvelope?.investorId) {
                    matchingAllocation = po.investorAllocations?.find((allocation) => {
                        const allocationInvestorId = allocation.investorId?._id || allocation.investorId;
                        return allocationInvestorId && String(allocationInvestorId) === String(matchingEnvelope.investorId);
                    }) || matchingAllocation;
                }

                if (matchingEnvelope) {
                    matchingEnvelope.status = normalized;
                    if (normalized === 'completed') {
                        matchingEnvelope.completedAt = statusTimestamp;
                    } else if (['sent', 'delivered', 'signed'].includes(normalized) && !matchingEnvelope.sentAt) {
                        matchingEnvelope.sentAt = statusTimestamp;
                    }
                }

                if (matchingAllocation) {
                    matchingAllocation.docuSignStatus = normalized;
                    if (normalized === 'completed') {
                        matchingAllocation.docuSignCompletedAt = statusTimestamp;
                    } else if (['sent', 'delivered', 'signed'].includes(normalized) && !matchingAllocation.docuSignSentAt) {
                        matchingAllocation.docuSignSentAt = statusTimestamp;
                    }
                }

                if (['sent', 'delivered', 'signed'].includes(normalized) && !po.docuSignSentAt) {
                    po.docuSignSentAt = statusTimestamp;
                }
                if (normalized === 'completed') {
                    po.docuSignSignedAt = po.docuSignSignedAt || statusTimestamp;
                }
            };

            const aggregateStatuses = () => {
                const statusOrder = ['failed', 'voided', 'declined', 'created', 'sent', 'delivered', 'signed', 'completed'];
                const statuses = (po.docuSignEnvelopes || []).map(env => env.status).filter(Boolean);

                if (statuses.length === 0) {
                    po.docuSignStatus = po.docuSignStatus || 'created';
                    return;
                }

                if (statuses.every(status => status === 'completed')) {
                    po.docuSignStatus = 'completed';
                    po.status = 'signed';
                    po.docuSignSignedAt = po.docuSignSignedAt || new Date();
                    return;
                }

                if (statuses.some(status => status === 'voided')) {
                    po.docuSignStatus = 'voided';
                    po.status = 'draft';
                    return;
                }

                if (statuses.some(status => status === 'declined')) {
                    po.docuSignStatus = 'declined';
                    po.status = 'rejected';
                    return;
                }

                if (statuses.some(status => status === 'failed')) {
                    po.docuSignStatus = 'failed';
                    return;
                }

                if (statuses.some(status => status === 'signed')) {
                    po.docuSignStatus = 'signed';
                    po.status = 'pending_signature';
                    return;
                }

                if (statuses.some(status => status === 'delivered')) {
                    po.docuSignStatus = 'delivered';
                    po.status = 'pending_signature';
                    return;
                }

                if (statuses.some(status => status === 'sent')) {
                    po.docuSignStatus = 'sent';
                    po.status = 'pending_signature';
                    return;
                }

                // Fallback to the highest precedence status found
                const sortedStatuses = statuses.sort((a, b) => statusOrder.indexOf(a) - statusOrder.indexOf(b));
                po.docuSignStatus = sortedStatuses[0] || po.docuSignStatus || 'sent';
            };

            // Check if any recipient has completed status
            const hasCompletedRecipient = data?.envelopeSummary?.recipients?.signers?.some(signer =>
                signer.status === 'completed' || signer.status === 'signed'
            );

            // Also check if the event indicates completion
            const isCompletionEvent = event === 'envelope-completed' || event === 'envelope-signed' || event === 'envelope-delivered';

            logger.info('📋 PO status processing:', {
                envelopeId,
                leadId: lead.leadId,
                currentStatus: lead.docuSign?.status,
                incomingStatus: docuSignStatus,
                event,
                willMarkCompleted: (docuSignStatus === 'completed' || hasCompletedRecipient || isCompletionEvent)
            });

            // Check for envelope deletion first (highest priority)
            if (event === 'envelope-deleted') {
                // Reset approval status when envelope is deleted
                lead.approval.status = 'not_submitted';
                lead.approval.approvals = [];
                po.docuSignStatus = 'voided';
                applyStatusToMatching('voided');
                po.status = 'draft'; // Reset PO status to draft
                po.docuSignError = `Envelope deleted in ${providerLabel}`;
                po.docuSignFailedAt = new Date();
                // Clear stored documents since envelope was deleted
                po.docuSignDocuments = [];
                logger.info(`Lead ${lead.leadId} Purchase Agreement deleted - approval reset and documents cleared`);
            } else if (docuSignStatus === 'declined' || docuSignStatus === 'voided') {
                // Reset approval status if declined or voided
                lead.approval.status = 'not_submitted';
                lead.approval.approvals = [];
                po.docuSignStatus = docuSignStatus;
                applyStatusToMatching(docuSignStatus);
                po.docuSignError = null;
                po.docuSignFailedAt = new Date();
                logger.info(`Lead ${lead.leadId} Purchase Agreement ${docuSignStatus} - approval reset`);
            } else if (docuSignStatus === 'completed' || hasCompletedRecipient || isCompletionEvent) {
                applyStatusToMatching('completed');
                po.docuSignStatus = 'completed';
                po.docuSignSignedAt = new Date();
                logger.info(`Lead ${lead.leadId} Purchase Agreement marked as completed`);
            } else {
                // Update with valid status
                applyStatusToMatching(docuSignStatus);
                po.docuSignStatus = validStatuses.includes(docuSignStatus) ? docuSignStatus : 'sent';
                logger.info(`Lead ${lead.leadId} ${providerLabel} status updated to: ${po.docuSignStatus}`);

                // If we're getting 'failed' status repeatedly, try to check the actual Zoho Sign status
                if (docuSignStatus === 'failed' && po.docuSignStatus === 'failed') {
                    logger.warn(`Lead ${lead.leadId} getting 'failed' status - this might indicate a webhook data issue`);
                    logger.warn(`Consider checking ${providerLabel} API directly for actual envelope status`);
                }
            }

            // Save both PurchaseOrder and Lead
            aggregateStatuses();
            await po.save();
            await lead.save();
            logger.info(`✅ PO ${po.poId} status updated to: ${po.docuSignStatus}`);

            // Queue document fetching asynchronously if completed
            if (docuSignStatus === 'completed' || hasCompletedRecipient || isCompletionEvent) {
                fetchPODocumentsAsync(
                    signatureService,
                    providerLabel,
                    envelopeId,
                    po._id,
                    lead._id,
                    matchingEnvelope?.investorId || (matchingAllocation?.investorId?._id || matchingAllocation?.investorId)
                ).catch(err => {
                    logger.error(`Error fetching PO documents asynchronously for ${envelopeId}:`, err);
                });
            }
        } else {
            logger.info(`📋 No matching record for envelope ${envelopeId}`);
        }

        if (po && !lead) {
            // Normalize status/event
            const statusLower = (status || '').toLowerCase();
            const eventLower = (event || '').toLowerCase();

            if (statusLower) {
                po.docuSignStatus = statusLower;
            }

            if (eventLower === 'envelope-deleted' || eventLower === 'envelope-voided' || statusLower === 'voided') {
                // Envelope deleted/voided in e-sign provider
                po.docuSignStatus = 'voided';
                po.status = 'draft';
                po.docuSignError = `Envelope deleted/voided in ${providerLabel}`;
                po.docuSignFailedAt = new Date();
                po.docuSignSignedAt = null;
                po.docuSignDocuments = [];
                logger.info(`PO ${po.poId} reset to draft after ${providerLabel} deletion/void.`);
            } else if (statusLower === 'completed') {
                po.status = 'signed';
                po.invoiceGenerated = false; // Ready for invoice generation
                logger.info(`PO ${po.poId} marked as signed after ${providerLabel} completion`);
            } else if (statusLower === 'declined') {
                po.status = 'rejected';
                logger.info(`PO ${po.poId} marked as rejected after ${providerLabel} ${statusLower}`);
            }

            await po.save();
        } else if (!po) {
            // No Purchase Order found for this envelope
            logger.warn(`No PO found for ${providerLabel} envelope ${envelopeId}`);
        }

        // Handle Investor Agreement if found
        if (investorAgreement && (!po || po.docuSignEnvelopeId !== envelopeId)) {
            const validStatuses = ['created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided', 'failed'];

            let docuSignStatus = status;
            if (!docuSignStatus) {
                docuSignStatus = data?.envelopeSummary?.status;
            }
            if (!docuSignStatus) {
                docuSignStatus = data?.status;
            }
            if (!docuSignStatus) {
                docuSignStatus = event;
            }

            docuSignStatus = docuSignStatus ? docuSignStatus.toLowerCase() : 'failed';

            // Get recipient statuses - check the actual signer status
            const recipientStatuses = data?.envelopeSummary?.recipients?.signers || [];
            const investorRecipient = recipientStatuses.find(signer =>
                signer.email?.toLowerCase() === investorAgreement.agreementData?.investorEmail?.toLowerCase()
            );
            const recipientStatus = investorRecipient?.status?.toLowerCase() || null;

            // Check if recipient has actually signed (not just viewed/delivered)
            const hasSignedRecipient = recipientStatus === 'completed' || recipientStatus === 'signed';

            // Check if event indicates recipient or envelope completion
            // recipient-completed means the recipient has signed
            // envelope-completed means the envelope is fully completed
            const isRecipientCompletedEvent = event === 'recipient-completed';
            const isEnvelopeCompletedEvent = event === 'envelope-completed' || event === 'envelope-signed';
            const isCompletionEvent = isRecipientCompletedEvent || isEnvelopeCompletedEvent;

            // Treat as completed if:
            // 1. Envelope status is completed AND (recipient has signed OR event indicates completion)
            // 2. Event is recipient-completed (recipient signed)
            // 3. Event is envelope-completed (envelope fully completed)
            const isEnvelopeCompleted = docuSignStatus === 'completed' && (hasSignedRecipient || isCompletionEvent);
            const shouldMarkAsCompleted = isRecipientCompletedEvent ||
                isEnvelopeCompleted ||
                (isEnvelopeCompletedEvent && docuSignStatus === 'completed');

            logger.info('📋 Investor Agreement status processing:', {
                envelopeId,
                agreementId: investorAgreement._id,
                currentStatus: investorAgreement.docuSignStatus,
                incomingStatus: docuSignStatus,
                event,
                shouldMarkCompleted: shouldMarkAsCompleted
            });

            if (event === 'envelope-deleted' || docuSignStatus === 'declined' || docuSignStatus === 'voided') {
                investorAgreement.docuSignStatus = docuSignStatus;
                investorAgreement.status = docuSignStatus;
                await investorAgreement.save();
                logger.info(`Investor Agreement ${investorAgreement._id} ${docuSignStatus}`);
            } else if (shouldMarkAsCompleted) {
                investorAgreement.docuSignStatus = 'completed';
                investorAgreement.status = 'completed';
                investorAgreement.completedAt = new Date();

                // Save status immediately, fetch documents asynchronously
                await investorAgreement.save();
                logger.info(`✅ Investor Agreement ${investorAgreement._id} marked as completed`);

                // Queue document fetching and email sending asynchronously
                processInvestorAgreementAsync(
                    signatureService,
                    providerLabel,
                    envelopeId,
                    investorAgreement._id,
                    event,
                    data,
                    recipientStatus,
                    docuSignStatus,
                    recipientStatuses,
                    investorAgreement,
                    data?.rawZohoPayload?.requests?.document_ids
                ).catch(err => {
                    logger.error(`Error processing investor agreement asynchronously for ${envelopeId}:`, err);
                });
            } else {
                // Update with valid status - but don't mark as completed unless actually signed
                // Handle intermediate statuses like 'delivered' (document was delivered but not signed yet)
                let newStatus = docuSignStatus;

                // Check if envelope is completed - if so, mark as completed (event-based detection handled above)
                // This handles cases where envelope status is "completed" but we didn't catch it in the completion check
                if (docuSignStatus === 'completed' && (isRecipientCompletedEvent || isEnvelopeCompletedEvent)) {
                    // This should have been caught above, but as a fallback, mark as completed
                    investorAgreement.docuSignStatus = 'completed';
                    investorAgreement.status = 'completed';
                    investorAgreement.completedAt = new Date();
                    await investorAgreement.save();
                    logger.info(`Investor Agreement ${investorAgreement._id} marked as completed (fallback: envelope status completed)`);
                }
                // If status is 'delivered' or recipient status is 'delivered', update to delivered
                else if (docuSignStatus === 'delivered' || recipientStatus === 'delivered') {
                    newStatus = 'delivered';
                }
                // If status is 'signed' but envelope is not completed, update to signed
                else if (docuSignStatus === 'signed' || recipientStatus === 'signed') {
                    newStatus = 'signed';
                }
                // Otherwise use the envelope status if valid
                else if (validStatuses.includes(docuSignStatus)) {
                    newStatus = docuSignStatus;
                }
                // Default to current status or 'sent'
                else {
                    newStatus = investorAgreement.docuSignStatus || 'sent';
                }

                // Only update if status actually changed and it's not a completion status
                // (completion status is handled above)
                if (newStatus !== 'completed' && newStatus !== investorAgreement.docuSignStatus) {
                    investorAgreement.docuSignStatus = newStatus;
                    investorAgreement.status = newStatus;
                    await investorAgreement.save();
                    logger.info(`Investor Agreement ${investorAgreement._id} status updated to: ${newStatus} (recipient status: ${recipientStatus})`);
                } else if (newStatus === 'completed') {
                    // Already handled above
                    logger.info(`Investor Agreement ${investorAgreement._id} already marked as completed`);
                } else {
                    logger.info(`Investor Agreement ${investorAgreement._id} status unchanged: ${investorAgreement.docuSignStatus} (incoming: ${docuSignStatus}, recipient: ${recipientStatus})`);
                }
            }

        }

        // Acknowledge webhook immediately (within 1-2 seconds)
        res.status(200).json({ success: true, message: 'Webhook received' });
    } catch (error) {
        logger.error(`${providerLabel} webhook error:`, error);
        // Return 200 to prevent Zoho Sign from retrying immediately
        if (!res.headersSent) {
            res.status(200).json({ success: false, message: 'Error processing webhook' });
        }
    }
};

/**
 * @desc    Zoho Sign webhook handler
 * @route   POST /api/webhooks/zohosign
 * @access  Public (webhook)
 */
exports.zohoSignWebhook = async (req, res, next) => {
    try {
        const incomingPayload = req.body || {};
        const payloadPreview = typeof incomingPayload === 'string'
            ? incomingPayload
            : JSON.stringify(incomingPayload, null, 2);
        logger.info(`📦 Zoho Sign raw webhook payload: ${payloadPreview}`);
        const normalizedPayload = buildZohoWebhookPayload(incomingPayload);
        req.body = normalizedPayload;
        req.rawBody = JSON.stringify(normalizedPayload);
        req.__provider = 'Zoho Sign';
        req.__signatureService = zohoSignService;
        await handleSignatureWebhook(req, res, next);
    } catch (error) {
        logger.error('Zoho Sign webhook error:', error);
        if (!res.headersSent) {
            res.status(200).json({ success: false, message: error.message || 'Error processing webhook' });
        }
    }
};

/**
 * Fetch and store PO documents asynchronously (runs after webhook response)
 */
function buildZohoWebhookPayload(body = {}) {
    const requestNode = body.requests || body.request || {};
    const actionsNode = Array.isArray(body.actions)
        ? body.actions
        : (Array.isArray(requestNode.actions) ? requestNode.actions : []);

    const requestId = requestNode.request_id || body.request_id || body.document_id;
    if (!requestId) {
        throw new Error('Zoho Sign webhook payload is missing request_id');
    }

    const eventType = String(body.event_type || body.event || requestNode.event_type || 'request-updated');
    const normalizedEvent = eventType.toLowerCase().replace(/\s+/g, '-');

    const statusRaw = requestNode.request_status || body.request_status || actionsNode[0]?.action_status;
    const normalizedStatus = zohoSignService.normalizeStatus(statusRaw || 'sent');

    const signers = actionsNode
        .filter(action => action && (action.recipient_email || action.recipient_name))
        .map(action => ({
            name: action.recipient_name || '',
            email: action.recipient_email || '',
            status: zohoSignService.normalizeStatus(action.action_status || action.status || normalizedStatus),
            recipientId: action.action_id,
            routingOrder: action.signing_order
        }));

    return {
        event: normalizedEvent,
        data: {
            envelopeId: requestId,
            status: normalizedStatus,
            envelopeSummary: {
                envelopeId: requestId,
                status: normalizedStatus,
                recipients: {
                    signers
                }
            },
            provider: 'Zoho Sign',
            rawZohoPayload: body
        }
    };
}

async function fetchPODocumentsAsync(signatureService, providerLabel, envelopeId, poId, leadId, investorId) {
    try {
        logger.info(`📥 Fetching signed documents for PO envelope ${envelopeId} via ${providerLabel}`);
        const service = signatureService || zohoSignService;
        const signedDocuments = await service.getSignedDocuments(envelopeId);

        if (signedDocuments && signedDocuments.length > 0) {
            const validDocuments = [];
            for (const doc of signedDocuments) {
                if (!doc.content || typeof doc.content !== 'string') {
                    logger.warn(`Document ${doc.documentId} (${doc.name}) has no content or invalid content type`);
                    continue;
                }

                try {
                    const cleanedBase64 = doc.content.replace(/^data:application\/pdf;base64,/, '');
                    const buffer = Buffer.from(cleanedBase64, 'base64');

                    if (buffer.length < 4 || buffer.slice(0, 4).toString() !== '%PDF') {
                        logger.error(`Document ${doc.documentId} (${doc.name}) does not appear to be a valid PDF`);
                        continue;
                    }

                    validDocuments.push({
                        documentId: doc.documentId,
                        name: doc.name,
                        fileType: doc.fileType || 'application/pdf',
                        fileSize: doc.fileSize || buffer.length,
                        content: cleanedBase64,
                        uri: doc.uri,
                        sourceEnvelopeId: envelopeId,
                        investorId: investorId
                    });
                } catch (validationError) {
                    logger.error(`Failed to validate document ${doc.documentId} (${doc.name}):`, validationError);
                    continue;
                }
            }

            if (validDocuments.length > 0) {
                const po = await PurchaseOrder.findById(poId);
                if (po) {
                    const existingDocuments = Array.isArray(po.docuSignDocuments) ? po.docuSignDocuments : [];
                    const filtered = existingDocuments.filter(existing =>
                        !(existing.sourceEnvelopeId === envelopeId &&
                            validDocuments.some(doc => doc.documentId === existing.documentId))
                    );
                    po.docuSignDocuments = [...filtered, ...validDocuments];
                    await po.save();
                    logger.info(`✅ Stored ${validDocuments.length} documents for PO ${po.poId}`);
                }
            }
        }
    } catch (error) {
        logger.error(`Error fetching PO documents for envelope ${envelopeId} via ${providerLabel}:`, error);
    }
}

/**
 * Process investor agreement asynchronously (document fetching + email sending)
 * Runs after webhook response to prevent memory issues and timeouts
 */
async function processInvestorAgreementAsync(
    signatureService,
    providerLabel,
    envelopeId,
    agreementId,
    event,
    data,
    recipientStatus,
    docuSignStatus,
    recipientStatuses,
    investorAgreement,
    fallbackDocumentMetadata = []
) {
    try {
        // Fetch and store signed documents
        logger.info(`📥 Fetching signed documents for Investor Agreement envelope ${envelopeId} via ${providerLabel}`);
        const service = signatureService || zohoSignService;
        const signedDocuments = await service.getSignedDocuments(
            envelopeId,
            fallbackDocumentMetadata
        );

        if (signedDocuments && signedDocuments.length > 0) {
            const validDocuments = [];
            for (const doc of signedDocuments) {
                if (!doc.content || typeof doc.content !== 'string') {
                    logger.warn(`Document ${doc.documentId} (${doc.name}) has no content or invalid content type`);
                    continue;
                }

                try {
                    const cleanedBase64 = doc.content.replace(/^data:application\/pdf;base64,/, '');
                    const buffer = Buffer.from(cleanedBase64, 'base64');

                    if (buffer.length < 4 || buffer.slice(0, 4).toString() !== '%PDF') {
                        logger.error(`Document ${doc.documentId} (${doc.name}) does not appear to be a valid PDF`);
                        continue;
                    }

                    validDocuments.push({
                        documentId: doc.documentId,
                        name: doc.name,
                        fileType: doc.fileType || 'application/pdf',
                        fileSize: doc.fileSize || buffer.length,
                        content: cleanedBase64,
                        uri: doc.uri
                    });
                } catch (validationError) {
                    logger.error(`Failed to validate Investor Agreement document ${doc.documentId}:`, validationError);
                    continue;
                }
            }

            if (validDocuments.length > 0) {
                const agreement = await InvestorAgreement.findById(agreementId);
                if (agreement) {
                    agreement.signedDocuments = validDocuments;
                    await agreement.save();
                    logger.info(`✅ Stored ${validDocuments.length} documents for Investor Agreement ${agreementId}`);
                }
            }
        }

        // Reload agreement to get latest state
        const refreshedAgreement = await InvestorAgreement.findById(agreementId);
        if (!refreshedAgreement) {
            logger.error(`Investor Agreement ${agreementId} not found after document fetch`);
            return;
        }

        // Check if recipient has signed - use multiple ways to detect signing
        const recipientHasSigned = event === 'recipient-completed' ||
            event === 'envelope-completed' ||
            event === 'envelope-signed' ||
            recipientStatus === 'completed' ||
            recipientStatus === 'signed' ||
            docuSignStatus === 'completed' ||
            refreshedAgreement.docuSignStatus === 'completed' ||
            refreshedAgreement.status === 'completed' ||
            (recipientStatuses.length > 0 && recipientStatuses.some(s => {
                const signerEmail = (s.email || '').toLowerCase().trim();
                const investorEmail = (investorAgreement.agreementData?.investorEmail || '').toLowerCase().trim();
                const signerStatus = (s.status || '').toLowerCase();
                return (signerStatus === 'completed' || signerStatus === 'signed') &&
                    signerEmail === investorEmail &&
                    signerEmail !== '';
            }));

        // Check if email should be sent
        const shouldSendEmail = recipientHasSigned &&
            !refreshedAgreement.activationEmailSent &&
            refreshedAgreement.investorId;

        if (shouldSendEmail) {
            try {
                const investor = await Investor.findById(refreshedAgreement.investorId._id || refreshedAgreement.investorId);

                if (investor && investor.status === 'invited') {
                    // Generate fresh invite token
                    const inviteToken = generateInviteToken();
                    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                    investor.inviteToken = inviteToken;
                    investor.inviteTokenExpiry = inviteTokenExpiry;
                    await investor.save();
                    logger.info(`✅ Generated fresh invite token for investor ${investor.email}`);

                    const inviteLink = `${process.env.DOMAIN_FRONTEND || process.env.DOMAIN_BACKEND || 'http://localhost:3000'}/invite/${inviteToken}`;

                    // Send activation email
                    if (process.env.USER_ACCOUNT_ACTIVATION_ID) {
                        try {
                            await sendMailtrapEmail({
                                templateUuid: process.env.USER_ACCOUNT_ACTIVATION_ID,
                                templateVariables: {
                                    name: investor.name,
                                    role: 'Investor',
                                    activation_link: inviteLink,
                                    year: new Date().getFullYear().toString()
                                },
                                recipients: [investor.email]
                            });

                            // Mark email as sent
                            refreshedAgreement.activationEmailSent = true;
                            refreshedAgreement.activationEmailSentAt = new Date();
                            await refreshedAgreement.save();

                            logger.info(`✅ Activation email sent to ${investor.email} after Investor Agreement signing`);
                        } catch (emailError) {
                            logger.error(`Failed to send activation email to ${investor.email}:`, emailError);
                        }
                    }
                }
            } catch (emailCheckError) {
                logger.error(`Error sending activation email for agreement ${agreementId}:`, emailCheckError);
            }
        }
    } catch (error) {
        logger.error(`Error processing investor agreement for envelope ${envelopeId} via ${providerLabel}:`, error);
    }
}

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

