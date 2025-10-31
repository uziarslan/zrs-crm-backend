const { Client } = require('@microsoft/microsoft-graph-client');
const logger = require('../utils/logger');

/**
 * Microsoft Teams / Graph API Integration Service
 * Handles calendar events for test drives
 */

class TeamsService {
    constructor() {
        this.accessToken = null;
        this.client = null;
    }

    /**
     * Set access token and initialize Graph client
     */
    setAccessToken(token) {
        this.accessToken = token;
        this.client = Client.init({
            authProvider: (done) => {
                done(null, this.accessToken);
            }
        });
    }

    /**
     * Get OAuth authorization URL for Microsoft Graph
     */
    getAuthorizationUrl() {
        const tenantId = process.env.MS_TENANT_ID || 'common';
        const clientId = process.env.MS_CLIENT_ID;
        const redirectUri = encodeURIComponent(process.env.MS_REDIRECT_URI);
        const scope = encodeURIComponent('Calendars.ReadWrite offline_access');

        return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}`;
    }

    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(code) {
        try {
            const axios = require('axios');
            const tenantId = process.env.MS_TENANT_ID || 'common';

            const params = new URLSearchParams();
            params.append('client_id', process.env.MS_CLIENT_ID);
            params.append('client_secret', process.env.MS_CLIENT_SECRET);
            params.append('code', code);
            params.append('redirect_uri', process.env.MS_REDIRECT_URI);
            params.append('grant_type', 'authorization_code');
            params.append('scope', 'Calendars.ReadWrite offline_access');

            const response = await axios.post(
                `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                params,
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );

            this.accessToken = response.data.access_token;
            this.setAccessToken(this.accessToken);

            logger.info('Microsoft Graph tokens obtained successfully');

            // In production, store tokens securely
            return {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token
            };
        } catch (error) {
            logger.error('MS Graph exchange code error:', error);
            throw new Error('Failed to exchange code for token');
        }
    }

    /**
     * Create calendar event for test drive
     */
    async createTestDriveEvent(eventData) {
        try {
            if (!this.client) {
                throw new Error('Teams service not authenticated');
            }

            const { vehicleInfo, customerName, customerEmail, startTime, duration } = eventData;

            const endTime = new Date(new Date(startTime).getTime() + duration * 60000);

            const event = {
                subject: `Test Drive: ${vehicleInfo.make} ${vehicleInfo.model}`,
                body: {
                    contentType: 'HTML',
                    content: `
            <h3>Test Drive Appointment</h3>
            <p><strong>Vehicle:</strong> ${vehicleInfo.vehicleId} - ${vehicleInfo.make} ${vehicleInfo.model} ${vehicleInfo.year}</p>
            <p><strong>Customer:</strong> ${customerName}</p>
            <p><strong>Email:</strong> ${customerEmail}</p>
            <p><strong>Mileage:</strong> ${vehicleInfo.mileage} km</p>
          `
                },
                start: {
                    dateTime: new Date(startTime).toISOString(),
                    timeZone: 'UTC'
                },
                end: {
                    dateTime: endTime.toISOString(),
                    timeZone: 'UTC'
                },
                attendees: [
                    {
                        emailAddress: {
                            address: customerEmail,
                            name: customerName
                        },
                        type: 'required'
                    }
                ],
                location: {
                    displayName: 'ZRS Cars Trading Showroom'
                },
                isOnlineMeeting: false
            };

            const result = await this.client.api('/me/events').post(event);

            logger.info(`Teams calendar event created: ${result.id}`);

            return {
                eventId: result.id,
                webLink: result.webLink,
                startTime: result.start.dateTime,
                endTime: result.end.dateTime
            };
        } catch (error) {
            logger.error('Teams create event error:', error);
            throw new Error('Failed to create calendar event');
        }
    }

    /**
     * Update calendar event
     */
    async updateTestDriveEvent(eventId, updates) {
        try {
            if (!this.client) {
                throw new Error('Teams service not authenticated');
            }

            const result = await this.client.api(`/me/events/${eventId}`).patch(updates);

            logger.info(`Teams calendar event updated: ${eventId}`);

            return result;
        } catch (error) {
            logger.error('Teams update event error:', error);
            throw new Error('Failed to update calendar event');
        }
    }

    /**
     * Cancel calendar event
     */
    async cancelTestDriveEvent(eventId) {
        try {
            if (!this.client) {
                throw new Error('Teams service not authenticated');
            }

            await this.client.api(`/me/events/${eventId}`).delete();

            logger.info(`Teams calendar event cancelled: ${eventId}`);

            return { success: true };
        } catch (error) {
            logger.error('Teams cancel event error:', error);
            throw new Error('Failed to cancel calendar event');
        }
    }

    /**
     * Get calendar events
     */
    async getCalendarEvents(startDate, endDate) {
        try {
            if (!this.client) {
                throw new Error('Teams service not authenticated');
            }

            const events = await this.client
                .api('/me/calendarview')
                .query({
                    startDateTime: new Date(startDate).toISOString(),
                    endDateTime: new Date(endDate).toISOString()
                })
                .get();

            return events.value;
        } catch (error) {
            logger.error('Teams get events error:', error);
            throw new Error('Failed to get calendar events');
        }
    }
}

module.exports = new TeamsService();

