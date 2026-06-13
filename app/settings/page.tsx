import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-6">
        <SettingsView />
      </div>
    </main>
  );
}
