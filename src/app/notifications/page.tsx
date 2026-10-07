'use client';

import DashboardNotifications from '@/app/dashboard/notifications/page';

// The same list sellers see in their dashboard, for every signed-in account.
export default function NotificationsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 md:py-10">
      <DashboardNotifications />
    </div>
  );
}
