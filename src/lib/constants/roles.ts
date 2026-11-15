import type { MemberRole } from '@/src/types/domain';

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'مالك المنظمة',
  teacher: 'مدرس',
  assistant: 'مساعد إداري',
  accountant: 'محاسب',
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: 'صلاحيات كاملة لإدارة المنظمة والموظفين والحسابات والإعدادات.',
  teacher: 'إدارة المجموعات والحصص والطلاب وتسجيل الحضور والغياب.',
  assistant: 'تسجيل الطلاب والحضور والجدول وتحصيل المدفوعات اليومية.',
  accountant: 'إدارة المدفوعات والمصروفات والتقارير المالية وسجل التدقيق.',
};

export const ROLE_PERMISSIONS_MATRIX: Array<{
  capability: string;
  owner: boolean;
  teacher: boolean;
  assistant: boolean;
  accountant: boolean;
}> = [
  { capability: 'إعدادات المنظمة وإدارة الموظفين', owner: true, teacher: false, assistant: false, accountant: false },
  { capability: 'إدارة الطلاب والمجموعات', owner: true, teacher: true, assistant: true, accountant: false },
  { capability: 'جدولة الحصص وتسجيل الحضور', owner: true, teacher: true, assistant: true, accountant: false },
  { capability: 'تسجيل وتعديل المدفوعات', owner: true, teacher: false, assistant: true, accountant: true },
  { capability: 'إدارة المصروفات وإلغاء القيود', owner: true, teacher: false, assistant: false, accountant: true },
  { capability: 'سجل التدقيق والتقارير المالية', owner: true, teacher: false, assistant: false, accountant: true },
];
