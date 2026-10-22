import {
  getNotifications,
  getNotificationPreference,
  getNotificationDeliveryOperations,
  getOrganizations,
  getSelectedOrganization,
} from "@/lib/api";
import { NotificationCenter } from "./notification-center";
import { NotificationDeliveryOperationsPanel } from "./notification-delivery-operations";

export default async function NotificationsPage() {
  const organizations = await getOrganizations();
  const organization = await getSelectedOrganization(organizations);
  if (!organization) return null;

  const [notificationPage, preferences, deliveryOperations] = await Promise.all([
    getNotifications(organization.id),
    getNotificationPreference(organization.id),
    ["OWNER", "ADMIN"].includes(organization.role)
      ? getNotificationDeliveryOperations(organization.id)
      : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Notifications</h1>
        <p className="mt-1 text-sm text-slate-600">
          Review assignments and remediation updates for {organization.name}.
        </p>
      </header>
      <NotificationCenter
        organizationId={organization.id}
        initialPage={notificationPage}
        initialPreferences={preferences}
      />
      {deliveryOperations && (
        <NotificationDeliveryOperationsPanel
          organizationId={organization.id}
          deliveryOperations={deliveryOperations}
        />
      )}
    </div>
  );
}
