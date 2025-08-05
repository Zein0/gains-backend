import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IPromoCode extends Document {
  code: string;
  type: 'free_month' | 'free_year' | 'lifetime' | 'discount_percent' | 'discount_amount';
  value?: number; // percentage (0-100) or amount in cents
  description?: string;
  isActive: boolean;
  usageLimit?: number; // null = unlimited
  usedCount: number;
  usedBy: mongoose.Types.ObjectId[]; // User IDs who used this code
  validFrom: Date;
  validUntil?: Date; // null = no expiry
  createdBy: mongoose.Types.ObjectId; // Admin user ID
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  isValid(userId?: mongoose.Types.ObjectId): { valid: boolean; reason?: string };
  use(userId: mongoose.Types.ObjectId): Promise<IPromoCode>;
  getDiscountInfo(): { type: string; value?: number; description: string };
}

export interface IPromoCodeModel extends Model<IPromoCode> {
  // Static methods
  findValidCode(code: string, userId?: mongoose.Types.ObjectId): Promise<IPromoCode | null>;
  generateUniqueCode(prefix?: string): Promise<string>;
}

const PromoCodeSchema = new Schema<IPromoCode>({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
    match: /^[A-Z0-9_-]+$/,
    index: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['free_month', 'free_year', 'lifetime', 'discount_percent', 'discount_amount'],
  },
  value: {
    type: Number,
    validate: {
      validator: function(this: IPromoCode, value: number) {
        if (this.type === 'free_month' || this.type === 'free_year' || this.type === 'lifetime') {
          return value === undefined;
        }
        if (this.type === 'discount_percent') {
          return value >= 0 && value <= 100;
        }
        if (this.type === 'discount_amount') {
          return value >= 0;
        }
        return true;
      },
      message: 'Invalid value for promo code type',
    },
  },
  description: {
    type: String,
    maxlength: 200,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  usageLimit: {
    type: Number,
    min: 1,
  },
  usedCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  usedBy: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  validFrom: {
    type: Date,
    default: Date.now,
    index: true,
  },
  validUntil: {
    type: Date,
    index: true,
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Indexes
PromoCodeSchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });
PromoCodeSchema.index({ type: 1 });
PromoCodeSchema.index({ createdAt: -1 });

// Methods
PromoCodeSchema.methods.toJSON = function() {
  const promoCode = this.toObject();
  delete promoCode.__v;
  delete promoCode.usedBy; // Don't expose user list in API responses
  return promoCode;
};

PromoCodeSchema.methods.isValid = function(userId?: mongoose.Types.ObjectId): { valid: boolean; reason?: string } {
  // Check if code is active
  if (!this.isActive) {
    return { valid: false, reason: 'Promo code is not active' };
  }

  // Check date validity
  const now = new Date();
  if (this.validFrom && this.validFrom > now) {
    return { valid: false, reason: 'Promo code is not yet valid' };
  }
  if (this.validUntil && this.validUntil < now) {
    return { valid: false, reason: 'Promo code has expired' };
  }

  // Check usage limit
  if (this.usageLimit && this.usedCount >= this.usageLimit) {
    return { valid: false, reason: 'Promo code usage limit reached' };
  }

  // Check if user already used this code
  if (userId && this.usedBy.includes(userId)) {
    return { valid: false, reason: 'You have already used this promo code' };
  }

  return { valid: true };
};

PromoCodeSchema.methods.use = function(userId: mongoose.Types.ObjectId): Promise<IPromoCode> {
  const validation = this.isValid(userId);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  this.usedCount += 1;
  this.usedBy.push(userId);
  return this.save();
};

PromoCodeSchema.methods.getDiscountInfo = function(): { type: string; value?: number; description: string } {
  switch (this.type) {
    case 'free_month':
      return { type: 'free_period', value: 1, description: 'One month free' };
    case 'free_year':
      return { type: 'free_period', value: 12, description: 'One year free' };
    case 'lifetime':
      return { type: 'lifetime', description: 'Lifetime access' };
    case 'discount_percent':
      return { type: 'percent', value: this.value, description: `${this.value}% discount` };
    case 'discount_amount':
      return { type: 'amount', value: this.value, description: `$${(this.value! / 100).toFixed(2)} discount` };
    default:
      return { type: 'unknown', description: 'Invalid promo code' };
  }
};

// Static methods
PromoCodeSchema.statics.findValidCode = function(code: string, userId?: mongoose.Types.ObjectId) {
  return this.findOne({ 
    code: code.toUpperCase(),
    isActive: true,
    validFrom: { $lte: new Date() },
    $or: [
      { validUntil: { $exists: false } },
      { validUntil: null },
      { validUntil: { $gte: new Date() } }
    ]
  }).then((promoCode: IPromoCode | null) => {
    if (!promoCode) return null;
    
    const validation = promoCode.isValid(userId);
    return validation.valid ? promoCode : null;
  });
};

PromoCodeSchema.statics.generateUniqueCode = async function(prefix: string = ''): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    const code = prefix ? `${prefix}${randomPart}` : randomPart;
    
    const existing = await this.findOne({ code });
    if (!existing) {
      return code;
    }
    
    attempts++;
  }
  
  throw new Error('Unable to generate unique promo code');
};

export const PromoCode = mongoose.model<IPromoCode, IPromoCodeModel>('PromoCode', PromoCodeSchema);