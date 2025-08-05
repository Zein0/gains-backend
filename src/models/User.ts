import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  firebaseUid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  phoneNumber?: string;
  isEmailVerified: boolean;
  fcmTokens: string[];
  subscription: {
    status: 'free_trial' | 'active' | 'canceled' | 'expired';
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    trialEndsAt?: Date;
    canceledAt?: Date;
    plan: 'monthly' | 'yearly';
  };
  settings: {
    notificationsEnabled: boolean;
    reminderTimes: string[]; // ['12:00', '18:00', '22:00', '23:00']
    theme: 'light' | 'dark' | 'system';
    units: {
      weight: 'kg' | 'lbs';
      height: 'cm' | 'ft';
    };
  };
  profile: {
    height?: number; // in cm
    dateOfBirth?: Date;
    gender?: 'male' | 'female' | 'other';
    activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  };
  isActive: boolean;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true,
  },
  displayName: {
    type: String,
    trim: true,
  },
  photoURL: {
    type: String,
  },
  phoneNumber: {
    type: String,
    sparse: true,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  fcmTokens: [{
    type: String,
  }],
  subscription: {
    status: {
      type: String,
      enum: ['free_trial', 'active', 'canceled', 'expired'],
      default: 'free_trial',
    },
    stripeCustomerId: String,
    stripeSubscriptionId: String,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    trialEndsAt: {
      type: Date,
      default: () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
    },
    canceledAt: Date,
    plan: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly',
    },
  },
  settings: {
    notificationsEnabled: {
      type: Boolean,
      default: true,
    },
    reminderTimes: [{
      type: String,
      default: ['12:00', '18:00', '22:00', '23:00'],
    }],
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system',
    },
    units: {
      weight: {
        type: String,
        enum: ['kg', 'lbs'],
        default: 'kg',
      },
      height: {
        type: String,
        enum: ['cm', 'ft'],
        default: 'cm',
      },
    },
  },
  profile: {
    height: Number, // in cm
    dateOfBirth: Date,
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },
    activityLevel: {
      type: String,
      enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastActiveAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Indexes
UserSchema.index({ 'subscription.status': 1 });
UserSchema.index({ 'subscription.trialEndsAt': 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ lastActiveAt: -1 });

// Methods
UserSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.__v;
  return user;
};

UserSchema.methods.updateLastActive = function() {
  this.lastActiveAt = new Date();
  return this.save();
};

UserSchema.methods.isTrialExpired = function(): boolean {
  if (this.subscription.status !== 'free_trial') return false;
  return this.subscription.trialEndsAt && this.subscription.trialEndsAt < new Date();
};

UserSchema.methods.isSubscriptionActive = function(): boolean {
  return this.subscription.status === 'active' || 
         (this.subscription.status === 'free_trial' && !this.isTrialExpired());
};

export const User = mongoose.model<IUser>('User', UserSchema);