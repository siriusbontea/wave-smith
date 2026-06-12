/**
 * The Create page (spec §9.2) — hero prompt, presets, Simple/Advanced tabs,
 * Forge, and the inline queue strip. All interactivity lives in client
 * components; this server component is just the shell.
 */
import { CreateForm } from "@/components/create/create-form";
import { QueueStrip } from "@/components/create/queue-strip";

export default function CreatePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">What do you want to hear?</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe it — Wavesmith forges full tracks with vocals, entirely on your machine.
          </p>
        </div>
        <CreateForm />
        <QueueStrip />
      </div>
    </main>
  );
}
