import mongoose, { Document, Schema } from 'mongoose';

export interface IProgress extends Document {
  userId: mongoose.Types.ObjectId;
  date: Date;
  weight: number; // in kg,
  musclesTrained: string[]; // e.g., ['chest', 'back', 'legs']
  photos: {
    front?: string; // URL to Cloudflare R2
    side?: string;  // URL to Cloudflare R2
    back?: string;  // URL to Cloudflare R2
    pose?: string;  // URL to Cloudflare R2 (optional)
  };
  measurements?: {
    chest?: number;    // in cm
    waist?: number;    // in cm
    hips?: number;     // in cm
    leftArm?: number;  // in cm
    rightArm?: number; // in cm
    leftThigh?: number; // in cm
    rightThigh?: number; // in cm
    neck?: number;     // in cm
  };
  bodyFatPercentage?: number;
  notes?: string;
  mood?: 1 | 2 | 3 | 4 | 5; // 1 = very bad, 5 = excellent
  energyLevel?: 1 | 2 | 3 | 4 | 5; // 1 = very low, 5 = very high
  sleepQuality?: 1 | 2 | 3 | 4 | 5; // 1 = very poor, 5 = excellent
  createdAt: Date;
  updatedAt: Date;
}

const ProgressSchema = new Schema<IProgress>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  date: {
    type: Date,
    required: true,
    index: true,
  },
  weight: {
    type: Number,
    required: true,
    min: 20, // 20kg minimum
    max: 500, // 500kg maximum
  },
  photos: {
    front: {
      type: String,
      match: /^https:\/\/.+/,
    },
    side: {
      type: String,
      match: /^https:\/\/.+/,
    },
    back: {
      type: String,
      match: /^https:\/\/.+/,
    },
    pose: {
      type: String,
      match: /^https:\/\/.+/,
    },
  },
  measurements: {
    chest: {
      type: Number,
      min: 50,
      max: 200,
    },
    waist: {
      type: Number,
      min: 40,
      max: 200,
    },
    hips: {
      type: Number,
      min: 50,
      max: 200,
    },
    leftArm: {
      type: Number,
      min: 15,
      max: 80,
    },
    rightArm: {
      type: Number,
      min: 15,
      max: 80,
    },
    leftThigh: {
      type: Number,
      min: 30,
      max: 120,
    },
    rightThigh: {
      type: Number,
      min: 30,
      max: 120,
    },
    neck: {
      type: Number,
      min: 20,
      max: 60,
    },
  },
  bodyFatPercentage: {
    type: Number,
    min: 3,
    max: 50,
  },
  notes: {
    type: String,
    maxlength: 1000,
    trim: true,
  },
  mood: {
    type: Number,
    min: 1,
    max: 5,
  },
  energyLevel: {
    type: Number,
    min: 1,
    max: 5,
  },
  sleepQuality: {
    type: Number,
    min: 1,
    max: 5,
  },
}, {
  timestamps: true,
});

// Compound indexes
ProgressSchema.index({ userId: 1, date: -1 }); // For user's progress history
ProgressSchema.index({ userId: 1, createdAt: -1 }); // For recent progress
ProgressSchema.index({ date: -1 }); // For date queries

// Ensure one progress entry per user per day
ProgressSchema.index({ userId: 1, date: 1 }, { unique: true });

// Virtual for formatted date
ProgressSchema.virtual('dateFormatted').get(function() {
  return this.date.toISOString().split('T')[0];
});

// Methods
ProgressSchema.methods.toJSON = function() {
  const progress = this.toObject();
  delete progress.__v;
  return progress;
};

ProgressSchema.methods.calculateBodyFat = function(userHeight: number, userGender: 'male' | 'female'): number {
  // Simple body fat calculation using weight and measurements
  // This is a simplified version - in production, you'd want a more accurate formula
  if (!this.measurements?.waist || !userHeight) {
    return 0;
  }

  const weight = this.weight;
  const waist = this.measurements.waist;
  const height = userHeight;

  if (userGender === 'male') {
    // Navy method for males (simplified)
    const neck = this.measurements?.neck || 38; // default neck size
    const bodyFat = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450;
    return Math.max(3, Math.min(50, Math.round(bodyFat * 10) / 10));
  } else {
    // Navy method for females (simplified)
    const neck = this.measurements?.neck || 32; // default neck size
    const hips = this.measurements?.hips || waist * 1.1; // estimate if not provided
    const bodyFat = 495 / (1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.22100 * Math.log10(height)) - 450;
    return Math.max(3, Math.min(50, Math.round(bodyFat * 10) / 10));
  }
};

// Static methods
ProgressSchema.statics.getProgressHistory = function(userId: string, days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.find({
    userId,
    date: { $gte: startDate }
  }).sort({ date: -1 });
};

ProgressSchema.statics.getLatestProgress = function(userId: string) {
  return this.findOne({ userId }).sort({ date: -1 });
};

ProgressSchema.statics.getProgressBetweenDates = function(userId: string, startDate: Date, endDate: Date) {
  return this.find({
    userId,
    date: { $gte: startDate, $lte: endDate }
  }).sort({ date: 1 });
};

export const Progress = mongoose.model<IProgress>('Progress', ProgressSchema);