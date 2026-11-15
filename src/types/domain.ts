export type OrganizationType = 'independent_teacher' | 'educational_center';

export type MemberRole = 'owner' | 'teacher' | 'assistant' | 'accountant';

export type MemberStatus = 'active' | 'invited' | 'suspended';

export type ThemePreference = 'light' | 'dark' | 'system';

export type StudentStatus = 'active' | 'inactive' | 'archived';

export type GroupStatus = 'active' | 'paused' | 'archived';

export type SessionStatus = 'scheduled' | 'completed' | 'cancelled';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export type PaymentStatus = 'posted' | 'partial' | 'pending' | 'voided';

export type PaymentMethod = 'cash' | 'vodafone_cash' | 'instapay' | 'bank_transfer' | 'card';

export type PaymentCategory = 'tuition' | 'materials' | 'registration' | 'other';

export type ExpenseCategory = 'rent' | 'salaries' | 'utilities' | 'printing' | 'marketing' | 'other';

export type ExpenseStatus = 'posted' | 'voided';

export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  phone?: string;
  themePreference: ThemePreference;
  activeOrganizationId?: string;
  organizationIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Organization {
  id: string;
  name: string;
  type: OrganizationType;
  ownerId: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  address?: string;
  currency: 'EGP';
  language: 'ar';
  themePreference: ThemePreference;
  academicYear: string;
  status: 'active' | 'suspended';
  createdAt: unknown;
  updatedAt: unknown;
}

export interface OrganizationMember {
  uid: string;
  organizationId: string;
  displayName: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  invitedBy?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Student {
  id: string;
  organizationId: string;
  fullName: string;
  phone: string;
  guardianName?: string;
  guardianPhone?: string;
  gradeLevel: string;
  status: StudentStatus;
  notes?: string;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface StudyGroup {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  gradeLevel: string;
  teacherId: string;
  teacherName: string;
  capacity: number;
  studentCount: number;
  scheduleSummary?: string;
  monthlyFee: number;
  status: GroupStatus;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ClassSession {
  id: string;
  organizationId: string;
  groupId: string;
  groupName: string;
  teacherId: string;
  teacherName: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
  status: SessionStatus;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AttendanceRecord {
  id: string;
  organizationId: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  groupId: string;
  status: AttendanceStatus;
  note?: string;
  recordedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PaymentRecord {
  id: string;
  organizationId: string;
  studentId: string;
  studentName: string;
  groupId?: string;
  amount: number;
  paidAmount: number;
  dueAmount: number;
  currency: 'EGP';
  category: PaymentCategory;
  method: PaymentMethod;
  status: PaymentStatus;
  referenceNumber?: string;
  notes?: string;
  recordedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ExpenseRecord {
  id: string;
  organizationId: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  currency: 'EGP';
  status: ExpenseStatus;
  expenseDate: string;
  notes?: string;
  recordedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  actorId: string;
  actorName: string;
  actorRole: MemberRole;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: unknown;
}

export interface StaffInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: Exclude<MemberRole, 'owner'>;
  invitedBy: string;
  invitedByName: string;
  status: InvitationStatus;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface TenantContextValue {
  userProfile: UserProfile | null;
  organization: Organization | null;
  membership: OrganizationMember | null;
  isLoading: boolean;
  error: string | null;
  refreshTenant: () => Promise<void>;
}
