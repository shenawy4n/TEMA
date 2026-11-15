# TEMA — Teacher Manager (منصة إدارة التعليم)

منصة SaaS متعددة المستأجرين (Multi-Tenant) لإدارة المعلمين المستقلين والمراكز التعليمية في مصر باللغة العربية (RTL) والعملة المحلية (EGP).

## المعمارية التقنية

- **الواجهة**: React 19 + TypeScript (Strict) + Tailwind CSS v4 + React Router + Lucide Icons
- **المصادقة وقاعدة البيانات**: Firebase Authentication + Cloud Firestore (Modular SDK)
- **عزل المستأجرين (Multi-Tenancy)**:
  - `users/{userId}`
  - `organizations/{organizationId}`
  - `organizations/{organizationId}/members/{userId}`
  - `organizations/{organizationId}/students/{studentId}`
  - `organizations/{organizationId}/groups/{groupId}`
  - `organizations/{organizationId}/sessions/{sessionId}`
  - `organizations/{organizationId}/attendance/{attendanceId}`
  - `organizations/{organizationId}/payments/{paymentId}`
  - `organizations/{organizationId}/expenses/{expenseId}`
  - `organizations/{organizationId}/auditLogs/{logId}`
  - `organizations/{organizationId}/invitations/{invitationId}`

## إعداد Firebase

تم ربط المشروع بمشروع Firebase عبر `firebase-applet-config.json` ونشر قواعد الأمان `firestore.rules`.

### تفعيل مزود البريد الإلكتروني وكلمة المرور (Email/Password)
يأتي المشروع مهيأً افتراضياً لتسجيل الدخول عبر **Google Sign-In**. لتفعيل تسجيل الدخول بالبريد الإلكتروني وكلمة المرور:
1. افتح لوحة تحكم Firebase: `https://console.firebase.google.com/project/gen-lang-client-0151650891/authentication/providers`
2. اختر **Authentication** ← **Sign-in method**.
3. فعّل **Email/Password** ثم احفظ التغييرات.

## الأمان وقواعد Firestore

- قواعد `firestore.rules` تعتمد مبدأ الرفض الافتراضي (`default deny`).
- يتم التحقق من عضوية المستخدم النشطة ودوره الوظيفي داخل `organizations/{orgId}/members/{uid}`.
- لا يمكن لأي مستخدم إنشاء منظمة دون إنشاء سجل المالك في نفس الدفعة الذرية (`writeBatch`).
- القيود المالية (`payments`, `expenses`) غير قابلة للحذف النهائي وتدعم الإلغاء المحاسبي (`voided`) فقط مع سجل تدقيق (`auditLogs`).
- فحص القواعد عبر ESLint: `npx eslint firestore.rules`
- خطة اختبار القواعد بالمحاكي موجودة في `security_spec.md` و`firestore.rules.test.ts`.
