const OAuthClient = require('intuit-oauth');
const axios = require('axios');
const logger = require('../utils/logger');

/**
 * QuickBooks Integration Service
 * Handles invoice sync and accounting operations
 */

class QuickBooksService {
    constructor() {
        this.oauthClient = new OAuthClient({
            clientId: process.env.QB_CLIENT_ID,
            clientSecret: process.env.QB_CLIENT_SECRET,
            environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
            redirectUri: process.env.QB_REDIRECT_URI
        });

        this.realmId = null; // Company ID, set after OAuth
        this.accessToken = null;
        this.refreshToken = null;
    }

    /**
     * Get OAuth authorization URL
     */
    getAuthorizationUrl() {
        try {
            const authUri = this.oauthClient.authorizeUri({
                scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
                state: 'zrs-crm-state'
            });

            return authUri;
        } catch (error) {
            logger.error('QuickBooks get auth URL error:', error);
            throw new Error('Failed to get QuickBooks authorization URL');
        }
    }

    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(code) {
        try {
            const authResponse = await this.oauthClient.createToken(code);

            this.accessToken = authResponse.token.access_token;
            this.refreshToken = authResponse.token.refresh_token;
            this.realmId = authResponse.token.realmId;

            logger.info('QuickBooks tokens obtained successfully');

            // In production, store these tokens securely in database
            return {
                accessToken: this.accessToken,
                refreshToken: this.refreshToken,
                realmId: this.realmId
            };
        } catch (error) {
            logger.error('QuickBooks exchange code error:', error);
            throw new Error('Failed to exchange code for token');
        }
    }

    /**
     * Refresh access token
     */
    async refreshAccessToken() {
        try {
            if (!this.refreshToken) {
                throw new Error('No refresh token available');
            }

            const authResponse = await this.oauthClient.refreshUsingToken(this.refreshToken);

            this.accessToken = authResponse.token.access_token;
            this.refreshToken = authResponse.token.refresh_token;

            logger.info('QuickBooks access token refreshed');

            return this.accessToken;
        } catch (error) {
            logger.error('QuickBooks refresh token error:', error);
            throw new Error('Failed to refresh access token');
        }
    }

    /**
     * Create customer in QuickBooks
     */
    async createCustomer(customerData) {
        try {
            const { name, email, phone } = customerData;

            const customer = {
                DisplayName: name,
                PrimaryEmailAddr: { Address: email },
                PrimaryPhone: { FreeFormNumber: phone }
            };

            const response = await this.makeRequest('POST', '/customer', customer);

            logger.info(`QuickBooks customer created: ${response.Customer.Id}`);

            return response.Customer;
        } catch (error) {
            logger.error('QuickBooks create customer error:', error);
            throw new Error('Failed to create customer in QuickBooks');
        }
    }

    /**
     * Create invoice in QuickBooks (after sale approval)
     */
    async createInvoice(invoiceData) {
        try {
            const { customerId, saleId, items, totalAmount } = invoiceData;

            const invoice = {
                CustomerRef: { value: customerId },
                Line: items.map(item => ({
                    Amount: item.amount,
                    DetailType: 'SalesItemLineDetail',
                    SalesItemLineDetail: {
                        ItemRef: { value: item.itemId || '1' }, // Default item
                        Qty: 1,
                        UnitPrice: item.amount
                    },
                    Description: item.description
                })),
                TxnDate: new Date().toISOString().split('T')[0],
                DueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days
                PrivateNote: `Sale ID: ${saleId}`
            };

            const response = await this.makeRequest('POST', '/invoice', invoice);

            logger.info(`QuickBooks invoice created for sale ${saleId}: ${response.Invoice.Id}`);

            return response.Invoice;
        } catch (error) {
            logger.error('QuickBooks create invoice error:', error);
            throw new Error('Failed to create invoice in QuickBooks');
        }
    }

    /**
     * Create purchase order in QuickBooks
     */
    async createPurchaseOrder(poData) {
        try {
            const { vendorId, poId, items, totalAmount } = poData;

            const purchaseOrder = {
                VendorRef: { value: vendorId || '1' }, // Default vendor
                Line: items.map(item => ({
                    Amount: item.amount,
                    DetailType: 'ItemBasedExpenseLineDetail',
                    ItemBasedExpenseLineDetail: {
                        ItemRef: { value: item.itemId || '1' },
                        Qty: 1,
                        UnitPrice: item.amount
                    },
                    Description: item.description
                })),
                TxnDate: new Date().toISOString().split('T')[0],
                PrivateNote: `PO ID: ${poId}`
            };

            const response = await this.makeRequest('POST', '/purchaseorder', purchaseOrder);

            logger.info(`QuickBooks PO created: ${response.PurchaseOrder.Id}`);

            return response.PurchaseOrder;
        } catch (error) {
            logger.error('QuickBooks create PO error:', error);
            throw new Error('Failed to create purchase order in QuickBooks');
        }
    }

    /**
     * Make API request to QuickBooks
     */
    async makeRequest(method, endpoint, data = null) {
        try {
            if (!this.accessToken || !this.realmId) {
                throw new Error('QuickBooks not authenticated');
            }

            const baseUrl = process.env.NODE_ENV === 'production'
                ? 'https://quickbooks.api.intuit.com/v3/company'
                : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

            const url = `${baseUrl}/${this.realmId}${endpoint}`;

            const config = {
                method,
                url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            };

            if (data) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;
        } catch (error) {
            if (error.response?.status === 401) {
                // Token expired, try to refresh
                await this.refreshAccessToken();
                return this.makeRequest(method, endpoint, data);
            }
            throw error;
        }
    }

    /**
     * Sync sale to QuickBooks (called after dual approval)
     */
    async syncSaleToQuickBooks(sale) {
        try {
            // Create customer if not exists
            const customer = await this.createCustomer({
                name: sale.customerName,
                email: sale.customerContact?.email,
                phone: sale.customerContact?.phone
            });

            // Create invoice
            const invoice = await this.createInvoice({
                customerId: customer.Id,
                saleId: sale.saleId,
                items: [{
                    amount: sale.sellingPrice,
                    description: `Vehicle: ${sale.vehicleId.vehicleId} - ${sale.vehicleId.make} ${sale.vehicleId.model}`
                }],
                totalAmount: sale.sellingPrice
            });

            logger.info(`Sale ${sale.saleId} synced to QuickBooks`);

            return {
                customerId: customer.Id,
                invoiceId: invoice.Id
            };
        } catch (error) {
            logger.error('Sync sale to QuickBooks error:', error);
            // Don't throw - log and continue (can retry later)
            return null;
        }
    }
}

module.exports = new QuickBooksService();

