const ExcelJS = require('exceljs');
const Lead = require('../models/Lead');
const Sale = require('../models/Sale');
const PurchaseOrder = require('../models/PurchaseOrder');
const Investor = require('../models/Investor');
const logger = require('../utils/logger');

/**
 * @desc    Export inventory to Excel
 * @route   GET /api/v1/export/inventory
 * @access  Private
 */
exports.exportInventory = async (req, res, next) => {
    try {
        const { status, make, model } = req.query;

        const query = {};
        if (status) query.status = status;
        if (make) query.make = { $regex: make, $options: 'i' };
        if (model) query.model = { $regex: model, $options: 'i' };

        const vehicles = await Vehicle.find(query)
            .populate('investorAllocation.investorId', 'name')
            .sort({ createdAt: -1 });

        // Create workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Inventory');

        // Add headers
        worksheet.columns = [
            { header: 'Vehicle ID', key: 'vehicleId', width: 15 },
            { header: 'Make', key: 'make', width: 15 },
            { header: 'Model', key: 'model', width: 20 },
            { header: 'Year', key: 'year', width: 10 },
            { header: 'Mileage', key: 'mileage', width: 12 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Purchase Price', key: 'purchasePrice', width: 15 },
            { header: 'Selling Price', key: 'sellingPrice', width: 15 },
            { header: 'Owner', key: 'ownerName', width: 20 },
            { header: 'Investors', key: 'investors', width: 30 },
            { header: 'Created At', key: 'createdAt', width: 15 }
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Add data
        vehicles.forEach(vehicle => {
            const investors = vehicle.investorAllocation
                .map(a => `${a.investorId?.name || 'N/A'} (${a.percentage}%)`)
                .join(', ');

            worksheet.addRow({
                vehicleId: vehicle.vehicleId,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                mileage: vehicle.mileage,
                status: vehicle.status,
                purchasePrice: vehicle.purchasePrice || vehicle.askingPrice,
                sellingPrice: vehicle.sellingPrice || '',
                ownerName: vehicle.ownerName,
                investors: investors || 'N/A',
                createdAt: vehicle.createdAt.toLocaleDateString()
            });
        });

        // Set response headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=inventory_${Date.now()}.xlsx`
        );

        // Write to response
        await workbook.xlsx.write(res);
        res.end();

        logger.info('Inventory exported to Excel');
    } catch (error) {
        logger.error('Export inventory error:', error);
        next(error);
    }
};

/**
 * @desc    Export leads to Excel
 * @route   GET /api/v1/export/leads
 * @access  Private
 */
exports.exportLeads = async (req, res, next) => {
    try {
        const { type, status } = req.query;

        const query = {};
        if (type) query.type = type;
        if (status) query.status = status;

        const leads = await Lead.find(query)
            .populate('assignedTo', 'name')
            .sort({ createdAt: -1 });

        // Create workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Leads');

        // Add headers
        worksheet.columns = [
            { header: 'Lead ID', key: 'leadId', width: 15 },
            { header: 'Type', key: 'type', width: 10 },
            { header: 'Contact Name', key: 'contactName', width: 20 },
            { header: 'Phone', key: 'phone', width: 15 },
            { header: 'Email', key: 'email', width: 25 },
            { header: 'Source', key: 'source', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Priority', key: 'priority', width: 10 },
            { header: 'Assigned To', key: 'assignedTo', width: 20 },
            { header: 'Vehicle Info', key: 'vehicleInfo', width: 30 },
            { header: 'Created At', key: 'createdAt', width: 15 }
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Add data
        leads.forEach(lead => {
            const vehicleInfo = lead.vehicleInfo?.make
                ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model} ${lead.vehicleInfo.year || ''}`
                : 'N/A';

            worksheet.addRow({
                leadId: lead.leadId,
                type: lead.type,
                contactName: lead.contactInfo.name,
                phone: lead.contactInfo.phone || '',
                email: lead.contactInfo.email || '',
                source: lead.source,
                status: lead.status,
                priority: lead.priority,
                assignedTo: lead.assignedTo?.name || 'Unassigned',
                vehicleInfo: vehicleInfo,
                createdAt: lead.createdAt.toLocaleDateString()
            });
        });

        // Set response headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=leads_${Date.now()}.xlsx`
        );

        // Write to response
        await workbook.xlsx.write(res);
        res.end();

        logger.info('Leads exported to Excel');
    } catch (error) {
        logger.error('Export leads error:', error);
        next(error);
    }
};

/**
 * @desc    Export sales report to Excel
 * @route   GET /api/v1/export/sales
 * @access  Private
 */
exports.exportSales = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        const query = { status: { $in: ['approved', 'completed'] } };

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const sales = await Sale.find(query)
            .populate('vehicleId')
            .sort({ createdAt: -1 });

        // Create workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sales Report');

        // Add headers
        worksheet.columns = [
            { header: 'Sale ID', key: 'saleId', width: 15 },
            { header: 'Vehicle', key: 'vehicle', width: 30 },
            { header: 'Customer', key: 'customer', width: 20 },
            { header: 'Purchase Price', key: 'purchasePrice', width: 15 },
            { header: 'Selling Price', key: 'sellingPrice', width: 15 },
            { header: 'Profit', key: 'profit', width: 15 },
            { header: 'Profit %', key: 'profitPercentage', width: 12 },
            { header: 'Sale Date', key: 'saleDate', width: 15 }
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Add data
        sales.forEach(sale => {
            const vehicle = sale.vehicleId
                ? `${sale.vehicleId.vehicleId} - ${sale.vehicleId.make} ${sale.vehicleId.model}`
                : 'N/A';

            worksheet.addRow({
                saleId: sale.saleId,
                vehicle: vehicle,
                customer: sale.customerName,
                purchasePrice: sale.purchasePrice,
                sellingPrice: sale.sellingPrice,
                profit: sale.profit,
                profitPercentage: sale.profitPercentage.toFixed(2) + '%',
                saleDate: sale.createdAt.toLocaleDateString()
            });
        });

        // Add summary row
        const totalProfit = sales.reduce((sum, sale) => sum + sale.profit, 0);
        const totalRevenue = sales.reduce((sum, sale) => sum + sale.sellingPrice, 0);

        worksheet.addRow({});
        worksheet.addRow({
            saleId: 'TOTAL',
            sellingPrice: totalRevenue,
            profit: totalProfit
        });

        // Set response headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=sales_report_${Date.now()}.xlsx`
        );

        // Write to response
        await workbook.xlsx.write(res);
        res.end();

        logger.info('Sales report exported to Excel');
    } catch (error) {
        logger.error('Export sales error:', error);
        next(error);
    }
};

/**
 * @desc    Export investor SOA to Excel
 * @route   GET /api/v1/export/investor-soa/:investorId
 * @access  Private
 */
exports.exportInvestorSOA = async (req, res, next) => {
    try {
        const { investorId } = req.params;

        const investor = await Investor.findById(investorId);
        if (!investor) {
            return res.status(404).json({
                success: false,
                message: 'Investor not found'
            });
        }

        // Create workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Statement of Accounts');

        // Add investor info
        worksheet.mergeCells('A1:D1');
        worksheet.getCell('A1').value = 'STATEMENT OF ACCOUNTS';
        worksheet.getCell('A1').font = { bold: true, size: 16 };
        worksheet.getCell('A1').alignment = { horizontal: 'center' };

        worksheet.addRow([]);
        worksheet.addRow(['Investor Name:', investor.name]);
        worksheet.addRow(['Email:', investor.email]);
        worksheet.addRow(['Credit Limit:', `AED ${investor.creditLimit.toLocaleString()}`]);
        worksheet.addRow(['Utilized Amount:', `AED ${investor.utilizedAmount.toLocaleString()}`]);
        worksheet.addRow(['Remaining Credit:', `AED ${investor.remainingCredit.toLocaleString()}`]);
        worksheet.addRow([]);

        // Add investments table
        worksheet.addRow(['INVESTMENTS']);
        worksheet.columns = [
            { header: 'Vehicle', key: 'vehicle', width: 30 },
            { header: 'Investment', key: 'investment', width: 15 },
            { header: 'Percentage', key: 'percentage', width: 12 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Date', key: 'date', width: 15 }
        ];

        // Add investment data
        for (const investment of investor.investments) {
            const vehicle = await Vehicle.findById(investment.carId);
            worksheet.addRow({
                vehicle: vehicle ? `${vehicle.vehicleId} - ${vehicle.make} ${vehicle.model}` : 'N/A',
                investment: `AED ${investment.amount.toLocaleString()}`,
                percentage: `${investment.percentage}%`,
                status: investment.status,
                date: investment.date.toLocaleDateString()
            });
        }

        // Set response headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=investor_soa_${investor.name}_${Date.now()}.xlsx`
        );

        // Write to response
        await workbook.xlsx.write(res);
        res.end();

        logger.info(`Investor SOA exported for ${investor.email}`);
    } catch (error) {
        logger.error('Export investor SOA error:', error);
        next(error);
    }
};

module.exports = exports;

