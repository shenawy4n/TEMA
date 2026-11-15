import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Minus, Plus, UserCog, XCircle } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Card } from '@/src/components/ui/Card';
import { Button } from '@/src/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/src/components/ui/DataTable';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { Modal } from '@/src/components/ui/Modal';
import { Input } from '@/src/components/ui/Input';
import { Select } from '@/src/components/ui/Select';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import {
  createStaffInvitation,
  listOrganizationMembers,
  listStaffInvitations,
  revokeStaffInvitation,
  updateMemberRoleOrStatus,
} from '@/src/services/staffService';
import { ROLE_LABELS, ROLE_PERMISSIONS_MATRIX } from '@/src/lib/constants/roles';
import { EMAIL_PATTERN } from '@/src/lib/firebase/validation';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { formatDateArabic } from '@/src/lib/utils/format';
import type { MemberRole, MemberStatus, OrganizationMember, StaffInvitation } from '@/src/types/domain';

export function StaffPage() {
  const { organization, membership } = useTenant();
  const { showToast } = useToast();

  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<MemberRole, 'owner'>>('assistant');
  const [submitting, setSubmitting] = useState(false);

  const [editMember, setEditMember] = useState<OrganizationMember | null>(null);
  const [editRole, setEditRole] = useState<Exclude<MemberRole, 'owner'>>('assistant');
  const [editStatus, setEditStatus] = useState<MemberStatus>('active');
  const [updatingMember, setUpdatingMember] = useState(false);

  const isOwner = membership?.role === 'owner';

  const loadStaff = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);
    try {
      const [mData, iData] = await Promise.all([
        listOrganizationMembers(organization.id),
        listStaffInvitations(organization.id),
      ]);
      setMembers(mData);
      setInvitations(iData);
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organization]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !membership || submitting) return;
    if (!EMAIL_PATTERN.test(inviteEmail.trim())) {
      showToast({ type: 'error', title: 'بريد إلكتروني غير صالح' });
      return;
    }

    setSubmitting(true);
    try {
      await createStaffInvitation(
        organization.id,
        { email: inviteEmail, role: inviteRole },
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        }
      );
      showToast({ type: 'success', title: 'تم إنشاء دعوة الانضمام' });
      setInviteOpen(false);
      setInviteEmail('');
      await loadStaff();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر إرسال الدعوة', message: getArabicErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    if (!organization || !membership) return;
    try {
      await revokeStaffInvitation(organization.id, invitationId, {
        uid: membership.uid,
        displayName: membership.displayName,
        role: membership.role,
      });
      showToast({ type: 'success', title: 'تم إلغاء الدعوة' });
      await loadStaff();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر الإلغاء', message: getArabicErrorMessage(err) });
    }
  };

  const openEditMember = (member: OrganizationMember) => {
    if (member.role === 'owner') return;
    setEditMember(member);
    setEditRole(member.role);
    setEditStatus(member.status);
  };

  const handleUpdateMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !editMember || !isOwner || updatingMember) return;
    setUpdatingMember(true);
    try {
      await updateMemberRoleOrStatus(organization.id, editMember.uid, {
        role: editRole,
        status: editStatus,
      });
      showToast({ type: 'success', title: 'تم تحديث صلاحيات العضو' });
      setEditMember(null);
      await loadStaff();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تحديث العضو', message: getArabicErrorMessage(err) });
    } finally {
      setUpdatingMember(false);
    }
  };

  const memberColumns: DataTableColumn<OrganizationMember>[] = [
    {
      key: 'name',
      header: 'الاسم',
      render: (m) => (
        <div>
          <p className="font-semibold">{m.displayName}</p>
          <p dir="ltr" className="text-xs text-slate-500 font-mono-tabular text-right">
            {m.email}
          </p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'الدور الوظيفي',
      render: (m) => ROLE_LABELS[m.role],
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (m) => (
        <span className={m.status === 'active' ? 'text-emerald-700 dark:text-emerald-400 text-xs font-medium' : 'text-amber-700 text-xs font-medium'}>
          {m.status === 'active' ? 'نشط' : m.status === 'invited' ? 'مدعو' : 'موقوف'}
        </span>
      ),
    },
    {
      key: 'joined',
      header: 'تاريخ الانضمام',
      render: (m) => <span className="text-xs text-slate-500">{formatDateArabic(m.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'إدارة',
      render: (m) =>
        isOwner && m.role !== 'owner' && m.uid !== membership?.uid ? (
          <Button size="sm" variant="outline" onClick={() => openEditMember(m)}>
            تعديل
          </Button>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  return (
    <AppShell
      pageTitle="الموظفون"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'الموظفون' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title="فريق العمل والصلاحيات"
          description="إدارة أعضاء المنظمة ودعوات الانضمام ومصفوفة الصلاحيات."
          actions={
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
              دعوة عضو جديد
            </Button>
          }
        />

        {loading ? (
          <LoadingState variant="table" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadStaff} />
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-3">
                الأعضاء النشطون
              </h3>
              <DataTable columns={memberColumns} data={members} rowKey={(m) => m.uid} />
            </div>

            <Card>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-3">
                دعوات الانضمام المسجلة
              </h3>
              {invitations.length === 0 ? (
                <EmptyState
                  icon={<UserCog className="h-6 w-6" />}
                  title="لا توجد دعوات معلقة"
                  description="يمكنك دعوة مدرسين أو مساعدين أو محاسبين للانضمام إلى المنظمة."
                />
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {invitations.map((inv) => (
                    <div key={inv.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                      <div>
                        <p dir="ltr" className="font-mono-tabular font-medium text-right">
                          {inv.email}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          الدور: {ROLE_LABELS[inv.role]} · الحالة:{' '}
                          {inv.status === 'pending' ? 'قيد الانتظار' : inv.status === 'accepted' ? 'مقبولة' : 'ملغاة'}
                        </p>
                      </div>
                      {inv.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<XCircle className="h-4 w-4" />}
                          onClick={() => handleRevoke(inv.id)}
                        >
                          إلغاء
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Permissions Overview */}
            <Card padding="none">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  نظرة عامة على الصلاحيات (RBAC)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-600 dark:text-slate-400">
                      <th className="px-4 py-3">الصلاحية</th>
                      <th className="px-4 py-3 text-center">مالك المنظمة</th>
                      <th className="px-4 py-3 text-center">مدرس</th>
                      <th className="px-4 py-3 text-center">مساعد إداري</th>
                      <th className="px-4 py-3 text-center">محاسب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {ROLE_PERMISSIONS_MATRIX.map((row) => (
                      <tr key={row.capability}>
                        <td className="px-4 py-3 font-medium">{row.capability}</td>
                        {(['owner', 'teacher', 'assistant', 'accountant'] as const).map((r) => (
                          <td key={r} className="px-4 py-3 text-center">
                            {row[r] ? (
                              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto" />
                            ) : (
                              <Minus className="h-4 w-4 text-slate-300 dark:text-slate-700 mx-auto" />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="دعوة عضو لفريق العمل">
        <form onSubmit={handleInvite} className="space-y-4">
          <Input
            label="البريد الإلكتروني للعضو"
            type="email"
            dir="ltr"
            placeholder="staff@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
          <Select
            label="الدور الوظيفي"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Exclude<MemberRole, 'owner'>)}
          >
            <option value="teacher">مدرس</option>
            <option value="assistant">مساعد إداري</option>
            <option value="accountant">محاسب</option>
          </Select>
          <div className="pt-3 flex items-center justify-end gap-2.5">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" isLoading={submitting}>
              إرسال الدعوة
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(editMember)}
        onClose={() => setEditMember(null)}
        title={`تعديل صلاحيات العضو — ${editMember?.displayName || ''}`}
      >
        {editMember && (
          <form onSubmit={handleUpdateMember} className="space-y-4">
            <Select
              label="الدور الوظيفي"
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as Exclude<MemberRole, 'owner'>)}
            >
              <option value="teacher">مدرس</option>
              <option value="assistant">مساعد إداري</option>
              <option value="accountant">محاسب</option>
            </Select>
            <Select
              label="حالة العضوية"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as MemberStatus)}
            >
              <option value="active">نشط</option>
              <option value="suspended">موقوف</option>
            </Select>
            <div className="pt-3 flex items-center justify-end gap-2.5">
              <Button variant="outline" onClick={() => setEditMember(null)} disabled={updatingMember}>
                إلغاء
              </Button>
              <Button type="submit" isLoading={updatingMember}>
                حفظ التعديلات
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </AppShell>
  );
}
