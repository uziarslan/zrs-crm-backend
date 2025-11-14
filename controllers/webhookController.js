const PurchaseOrder = require('../models/PurchaseOrder');
const Lead = require('../models/Lead');
const InvestorAgreement = require('../models/InvestorAgreement');
const Investor = require('../models/Investor');
const logger = require('../utils/logger');
const { sendNotificationEmail } = require('../utils/emailService');
const { sendMailtrapEmail } = require('../services/mailtrapService');
const { generateInviteToken } = require('../utils/otpHelper');
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

        logger.info('Webhook lookup:', {
            envelopeId,
            investorAgreementFound: !!investorAgreement,
            purchaseOrderFound: !!po,
            leadFound: !!lead,
            leadId: lead?.leadId,
            docuSignStatus: po?.docuSignStatus
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
                applyStatusToMatching('voided');
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
                applyStatusToMatching(docuSignStatus);
                po.docuSignError = null;
                po.docuSignFailedAt = new Date();
                logger.info(`Lead ${lead.leadId} Purchase Agreement ${docuSignStatus} - approval reset`);
            } else if (docuSignStatus === 'completed' || hasCompletedRecipient || isCompletionEvent) {
                applyStatusToMatching('completed');
                po.docuSignStatus = 'completed';
                po.docuSignSignedAt = new Date();

                // Fetch and store the signed documents with base64 validation
                try {
                    logger.info(`Fetching signed documents for envelope ${envelopeId}`);
                    const signedDocuments = await docusignService.getSignedDocuments(envelopeId);

                    if (signedDocuments && signedDocuments.length > 0) {
                        // Validate and filter documents with valid base64 PDF content
                        const validDocuments = [];
                        const investorIdForDoc = matchingEnvelope?.investorId || (matchingAllocation?.investorId?._id || matchingAllocation?.investorId);
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
                                    uri: doc.uri,
                                    sourceEnvelopeId: envelopeId,
                                    investorId: investorIdForDoc
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
                            const existingDocuments = Array.isArray(po.docuSignDocuments) ? po.docuSignDocuments : [];
                            const filtered = existingDocuments.filter(existing => !(existing.sourceEnvelopeId === envelopeId && validDocuments.some(doc => doc.documentId === existing.documentId)));
                            po.docuSignDocuments = [...filtered, ...validDocuments];
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
                applyStatusToMatching(docuSignStatus);
                po.docuSignStatus = validStatuses.includes(docuSignStatus) ? docuSignStatus : 'sent';
                logger.info(`Lead ${lead.leadId} DocuSign status updated to: ${po.docuSignStatus}`);

                // If we're getting 'failed' status repeatedly, try to check the actual DocuSign status
                if (docuSignStatus === 'failed' && po.docuSignStatus === 'failed') {
                    logger.warn(`Lead ${lead.leadId} getting 'failed' status - this might indicate a webhook data issue`);
                    logger.warn('Consider checking DocuSign API directly for actual envelope status');
                }
            }

            // Save both PurchaseOrder and Lead
            aggregateStatuses();
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

        if (po && !lead) {
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
        } else if (!po) {
            // No Purchase Order found for this envelope
            logger.warn(`No PO found for DocuSign envelope ${envelopeId}`);
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

            logger.info('🔍 INVESTOR AGREEMENT STATUS PROCESSING:');
            logger.info('📋 Envelope ID:', envelopeId);
            logger.info('📋 Investor Agreement ID:', investorAgreement._id);
            logger.info('📋 Current Status:', investorAgreement.docuSignStatus);
            logger.info('📋 Incoming Status:', docuSignStatus);
            logger.info('📋 Event:', event);
            logger.info('📋 Recipient Status:', recipientStatus);
            logger.info('📋 Has Signed Recipient:', hasSignedRecipient);
            logger.info('📋 Is Recipient Completed Event:', isRecipientCompletedEvent);
            logger.info('📋 Is Envelope Completed Event:', isEnvelopeCompletedEvent);
            logger.info('📋 Is Completion Event:', isCompletionEvent);
            logger.info('📋 Should Mark As Completed:', shouldMarkAsCompleted);
            logger.info('📋 All Recipient Statuses:', recipientStatuses.map(s => ({ email: s.email, status: s.status })));

            if (event === 'envelope-deleted' || docuSignStatus === 'declined' || docuSignStatus === 'voided') {
                investorAgreement.docuSignStatus = docuSignStatus;
                investorAgreement.status = docuSignStatus;
                await investorAgreement.save();
                logger.info(`Investor Agreement ${investorAgreement._id} ${docuSignStatus}`);
            } else if (shouldMarkAsCompleted) {
                investorAgreement.docuSignStatus = 'completed';
                investorAgreement.status = 'completed';
                investorAgreement.completedAt = new Date();

                // Fetch and store the signed documents
                try {
                    logger.info(`Fetching signed documents for Investor Agreement envelope ${envelopeId}`);
                    const signedDocuments = await docusignService.getSignedDocuments(envelopeId);

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

                                logger.info(`✅ Validated and storing Investor Agreement document ${doc.documentId}:`, {
                                    name: doc.name,
                                    contentLength: cleanedBase64.length,
                                    pdfSize: buffer.length
                                });
                            } catch (validationError) {
                                logger.error(`Failed to validate Investor Agreement document ${doc.documentId}:`, validationError);
                                continue;
                            }
                        }

                        if (validDocuments.length > 0) {
                            investorAgreement.signedDocuments = validDocuments;
                            logger.info(`✅ Stored ${validDocuments.length} validated signed documents for Investor Agreement ${investorAgreement._id}`);
                        }
                    }
                } catch (docError) {
                    logger.error(`Error fetching signed documents for Investor Agreement envelope ${envelopeId}:`, docError);
                }

                await investorAgreement.save();

                logger.info(`✅ Investor Agreement ${investorAgreement._id} completed`);
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

            // Send activation email when investor signs (check after all status updates)
            // Reload agreement to get latest state after save
            const refreshedAgreement = await InvestorAgreement.findById(investorAgreement._id);
            if (!refreshedAgreement) {
                logger.error(`Investor Agreement ${investorAgreement._id} not found after save`);
                return res.status(200).json({ success: true, message: 'Webhook processed' });
            }

            // Check if recipient has signed - use multiple ways to detect signing
            // Priority: event type > recipient status > envelope status > agreement status
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

            // Check if email should be sent (recipient signed AND email not yet sent)
            const shouldSendEmail = recipientHasSigned &&
                !refreshedAgreement.activationEmailSent &&
                refreshedAgreement.investorId;

            if (shouldSendEmail) {
                try {
                    const investor = await Investor.findById(refreshedAgreement.investorId._id || refreshedAgreement.investorId);

                    logger.info('🔍 CHECKING ACTIVATION EMAIL:', {
                        envelopeId,
                        investorId: refreshedAgreement.investorId,
                        investorFound: !!investor,
                        investorStatus: investor?.status,
                        activationEmailSent: refreshedAgreement.activationEmailSent,
                        recipientStatus: recipientStatus,
                        docuSignStatus: docuSignStatus,
                        event: event,
                        recipientHasSigned: recipientHasSigned,
                        allRecipients: recipientStatuses.map(s => ({ email: s.email, status: s.status }))
                    });

                    if (investor && investor.status === 'invited') {
                        // Always generate a fresh invite token when agreement is signed
                        // This ensures the token is not expired when the investor receives the email
                        const inviteToken = generateInviteToken();
                        const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
                        investor.inviteToken = inviteToken;
                        investor.inviteTokenExpiry = inviteTokenExpiry;
                        await investor.save();
                        logger.info(`✅ Generated fresh invite token for investor ${investor.email} (expires: ${inviteTokenExpiry.toISOString()})`);

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
                                logger.info(`✅ Activation email flag set for agreement ${refreshedAgreement._id}`);
                            } catch (emailError) {
                                logger.error(`Failed to send activation email to ${investor.email} after agreement signing:`, emailError);
                                logger.error('Email error details:', {
                                    message: emailError.message,
                                    stack: emailError.stack,
                                    templateUuid: process.env.USER_ACCOUNT_ACTIVATION_ID,
                                    investorEmail: investor.email
                                });
                            }
                        } else {
                            logger.warn('USER_ACCOUNT_ACTIVATION_ID not configured - cannot send activation email');
                        }
                    } else {
                        logger.info(`Skipping activation email - investor status: ${investor?.status || 'not found'}, email already sent: ${refreshedAgreement.activationEmailSent}`);
                    }
                } catch (emailCheckError) {
                    logger.error(`Error checking/sending activation email for investor agreement ${refreshedAgreement._id}:`, emailCheckError);
                    logger.error('Email check error details:', {
                        message: emailCheckError.message,
                        stack: emailCheckError.stack
                    });
                }
            } else {
                logger.info('🔍 ACTIVATION EMAIL CHECK SKIPPED:', {
                    recipientHasSigned,
                    agreementExists: !!refreshedAgreement,
                    activationEmailSent: refreshedAgreement?.activationEmailSent ?? false,
                    shouldSendEmail,
                    investorId: refreshedAgreement?.investorId,
                    recipientStatus: recipientStatus,
                    docuSignStatus: docuSignStatus,
                    agreementStatus: refreshedAgreement?.status,
                    agreementDocuSignStatus: refreshedAgreement?.docuSignStatus,
                    event: event,
                    recipientStatuses: recipientStatuses.map(s => ({ email: s.email, status: s.status }))
                });
            }
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

