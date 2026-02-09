import mongoose from 'mongoose';

const dailyReportSchema = new mongoose.Schema({
  day: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['yes', 'no', 'not_reported'],
    default: 'not_reported'
  },
  reportedAt: Date
}, { _id: false });

const userSankalpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sankalpId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sankalp',
    required: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'active',
    index: true
  },
  currentDay: {
    type: Number,
    default: 1,
    min: 1
  },
  totalDays: {
    type: Number,
    required: true,
    min: 1
  },
  dailyReports: [dailyReportSchema],
  karmaEarned: {
    type: Number,
    default: 0,
    min: 0
  },
  completionBonusEarned: {
    type: Number,
    default: 0,
    min: 0
  },
  completedAt: Date
}, {
  timestamps: true
});

// Compound index for user + sankalp uniqueness
userSankalpSchema.index({ userId: 1, sankalpId: 1 });

// Method to check if user can report today
userSankalpSchema.methods.canReportToday = function() {
  if (this.status !== 'active') return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayReport = this.dailyReports.find(report => {
    const reportDate = new Date(report.date);
    reportDate.setHours(0, 0, 0, 0);
    return reportDate.getTime() === today.getTime();
  });
  
  return !todayReport || todayReport.status === 'not_reported';
};

// Method to get today's report
userSankalpSchema.methods.getTodayReport = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return this.dailyReports.find(report => {
    const reportDate = new Date(report.date);
    reportDate.setHours(0, 0, 0, 0);
    return reportDate.getTime() === today.getTime();
  });
};

export default mongoose.model('UserSankalp', userSankalpSchema);
