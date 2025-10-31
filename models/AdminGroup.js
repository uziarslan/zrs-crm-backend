const mongoose = require('mongoose');

const AdminGroupSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            maxlength: 50
        },
        members: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Admin'
            }
        ]
    },
    { timestamps: true }
);

module.exports = mongoose.model('AdminGroup', AdminGroupSchema);


