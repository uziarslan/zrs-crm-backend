const { MailtrapClient } = require("mailtrap");
const logger = require('../utils/logger');

/**
 * Mailtrap Email Service
 * 
 * A flexible service for sending templated emails via Mailtrap
 * with dynamic template UUIDs, variables, and recipients.
 */

// Initialize Mailtrap client
const client = new MailtrapClient({
    token: process.env.MAILTRAP_API_TOKEN,
});

// Default sender configuration
const DEFAULT_SENDER = {
    email: "info@zrscarstrading.com",
    name: "ZRS Cars Trading",
};

/**
 * Send email using Mailtrap template
 * 
 * @param {Object} options - Email options
 * @param {string} options.templateUuid - Template UUID from Mailtrap
 * @param {Object} options.templateVariables - Template variables object (key-value pairs)
 * @param {Array|string} options.recipients - Recipient(s) email(s) - can be array of objects or array of strings
 * @param {Object} [options.sender] - Optional sender override { email, name }
 * @param {Array} [options.cc] - Optional CC recipients
 * @param {Array} [options.bcc] - Optional BCC recipients
 * @param {Array} [options.attachments] - Optional attachments
 * 
 * @returns {Promise<Object>} Send result from Mailtrap
 * 
 * @example
 * // Basic usage with array of email strings
 * await sendMailtrapEmail({
 *   templateUuid: "a139131b-5452-420d-b24b-ba4db201fc0c",
 *   templateVariables: {
 *     investor_name: "John Doe",
 *     po_number: "PO0001",
 *     issue_date: "2025-01-15",
 *     total_amount: "58,000",
 *     year: "2025"
 *   },
 *   recipients: ["john@example.com"]
 * });
 * 
 * @example
 * // With multiple recipients and custom sender
 * await sendMailtrapEmail({
 *   templateUuid: "a139131b-5452-420d-b24b-ba4db201fc0c",
 *   templateVariables: {
 *     investor_name: "John Doe",
 *     po_number: "PO0001"
 *   },
 *   recipients: [
 *     { email: "john@example.com" },
 *     { email: "jane@example.com", name: "Jane Doe" }
 *   ],
 *   sender: { email: "custom@zrscarstrading.com", name: "Custom Sender" },
 *   cc: ["manager@example.com"]
 * });
 */
const sendMailtrapEmail = async ({
    templateUuid,
    templateVariables,
    recipients,
    sender = DEFAULT_SENDER,
    cc = [],
    bcc = [],
    attachments = []
}) => {
    try {
        // Validate required parameters
        if (!templateUuid) {
            throw new Error('Template UUID is required');
        }

        if (!templateVariables || typeof templateVariables !== 'object') {
            throw new Error('Template variables must be an object');
        }

        if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
            throw new Error('At least one recipient is required');
        }

        if (!process.env.MAILTRAP_API_TOKEN) {
            throw new Error('MAILTRAP_API_TOKEN is not configured in environment variables');
        }

        // Normalize recipients array
        // Handle both string array and object array
        let normalizedRecipients = [];
        if (typeof recipients === 'string') {
            // Single email string
            normalizedRecipients = [{ email: recipients }];
        } else if (Array.isArray(recipients)) {
            normalizedRecipients = recipients.map(recipient => {
                if (typeof recipient === 'string') {
                    return { email: recipient };
                }
                return recipient; // Already an object with email (and optional name)
            });
        } else {
            throw new Error('Recipients must be a string, array of strings, or array of objects');
        }

        // Normalize CC and BCC (same truncation)
        const normalizedCC = Array.isArray(cc)
            ? cc.map(email => typeof email === 'string' ? { email } : email)
            : [];

        const normalizedBCC = Array.isArray(bcc)
            ? bcc.map(email => typeof email === 'string' ? { email } : email)
            : [];

        // Prepare email payload
        const emailPayload = {
            from: sender,
            to: normalizedRecipients,
            template_uuid: templateUuid,
            template_variables: templateVariables,
        };

        // Add optional fields if provided
        if (normalizedCC.length > 0) {
            emailPayload.cc = normalizedCC;
        }

        if (normalizedBCC.length > 0) {
            emailPayload.bcc = normalizedBCC;
        }

        if (attachments.length > 0) {
            const looksBase64 = (s) => typeof s === 'string' && s.length > 0 && s.replace(/[A-Za-z0-9+/=]/g, '') === '' && (s.length % 4 === 0);
            emailPayload.attachments = attachments.map(att => {
                let base64Content = '';
                if (typeof att.content === 'string') {
                    base64Content = looksBase64(att.content)
                        ? att.content
                        : Buffer.from(att.content, 'utf8').toString('base64');
                } else if (att.content) {
                    base64Content = Buffer.from(att.content).toString('base64');
                }
                return {
                    filename: att.filename,
                    content: base64Content,
                    type: att.type || 'application/octet-stream',
                    disposition: att.disposition || 'attachment'
                };
            });
        }

        // Log email details (without sensitive data)
        logger.info(`Sending Mailtrap email: template=${templateUuid}, recipients=${normalizedRecipients.length}`);

        // Send email via Mailtrap
        const result = await client.send(emailPayload);

        logger.info(`Mailtrap email sent successfully: ${result.message_ids?.join(', ') || 'sent'}`);

        return {
            success: true,
            messageIds: result.message_ids || [],
            result
        };

    } catch (error) {
        logger.error('Failed to send Mailtrap email:', error);
        throw new Error(`Mailtrap email failed: ${error.message}`);
    }
};

module.exports = {
    sendMailtrapEmail,
    client, // Export client for advanced usage if needed
};

