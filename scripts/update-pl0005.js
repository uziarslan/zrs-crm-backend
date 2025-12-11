require('dotenv').config();
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const SellOrder = require('../models/SellOrder');
const SellInvoice = require('../models/SellInvoice');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ MongoDB Connected');
    } catch (error) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        process.exit(1);
    }
};

const updatePL0005 = async () => {
    try {
        await connectDB();

        // Find the lead with leadId PL0005
        const lead = await Lead.findOne({ leadId: 'PL0005' });

        if (!lead) {
            console.log('❌ Lead PL0005 not found');
            process.exit(1);
        }

        console.log(`Found lead: ${lead.leadId} (Status: ${lead.status})`);

        // Delete sell invoice if it exists
        if (lead.sellInvoice) {
            const sellInvoice = await SellInvoice.findById(lead.sellInvoice);
            if (sellInvoice) {
                await SellInvoice.findByIdAndDelete(lead.sellInvoice);
                console.log('✅ Deleted sell invoice');
            }
            lead.sellInvoice = undefined;
        }

        // Delete sell order if it exists
        if (lead.sellOrder) {
            const sellOrder = await SellOrder.findById(lead.sellOrder);
            if (sellOrder) {
                await SellOrder.findByIdAndDelete(lead.sellOrder);
                console.log('✅ Deleted sell order');
            }
            lead.sellOrder = undefined;
        }

        // Update status to 'sale' (sales tab)
        lead.status = 'sale';
        lead.soldPrice = undefined;

        await lead.save();
        console.log('✅ Updated lead status to "sale" and removed sell invoice/order references');

        console.log('\n✅ Successfully updated PL0005:');
        console.log(`   - Status: ${lead.status}`);
        console.log(`   - Sell Invoice: ${lead.sellInvoice || 'None'}`);
        console.log(`   - Sell Order: ${lead.sellOrder || 'None'}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error updating PL0005:', error);
        process.exit(1);
    }
};

updatePL0005();
