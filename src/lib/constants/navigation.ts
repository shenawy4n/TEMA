import {
  LayoutDashboard,
  Users,
  Layers,
  CalendarClock,
  ClipboardCheck,
  Wallet,
  UserCog,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { MemberRole } from '@/src/types/domain';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  allowedRoles: MemberRole[];
}

export const SIDEBAR_NAVIGATION: NavItem[] = [
  {
    id: 'dashboard',
    label: 'لوحة التحكم',
    path: '/dashboard',
    icon: LayoutDashboard,
    allowedRoles: ['owner', 'teacher', 'assistant', 'accountant'],
  },
  {
    id: 'students',
    label: 'الطلاب',
    path: '/students',
    icon: Users,
    allowedRoles: ['owner', 'teacher', 'assistant', 'accountant'],
  },
  {
    id: 'groups',
    label: 'المجموعات',
    path: '/groups',
    icon: Layers,
    allowedRoles: ['owner', 'teacher', 'assistant'],
  },
  {
    id: 'sessions',
    label: 'الحصص والجدول',
    path: '/sessions',
    icon: CalendarClock,
    allowedRoles: ['owner', 'teacher', 'assistant'],
  },
  {
    id: 'attendance',
    label: 'الحضور والغياب',
    path: '/attendance',
    icon: ClipboardCheck,
    allowedRoles: ['owner', 'teacher', 'assistant'],
  },
  {
    id: 'finance',
    label: 'الحسابات والمدفوعات',
    path: '/finance',
    icon: Wallet,
    allowedRoles: ['owner', 'accountant', 'assistant'],
  },
  {
    id: 'staff',
    label: 'الموظفون',
    path: '/staff',
    icon: UserCog,
    allowedRoles: ['owner'],
  },
  {
    id: 'reports',
    label: 'التقارير',
    path: '/reports',
    icon: BarChart3,
    allowedRoles: ['owner', 'accountant', 'teacher'],
  },
  {
    id: 'settings',
    label: 'الإعدادات',
    path: '/settings',
    icon: Settings,
    allowedRoles: ['owner', 'teacher', 'assistant', 'accountant'],
  },
];
