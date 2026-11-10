import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Settings</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">This Mac</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Offline is the default. Grok is optional and only helps with words — never the audio.
      </p>
      <div className="mt-6">
        <SettingsView />
      </div>
    </main>
  );
}
