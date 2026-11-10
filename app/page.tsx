/**
 * The Create page (spec §9.2) — hero prompt, presets, Simple/Advanced tabs,
 * Forge, and the inline queue strip. All interactivity lives in client
 * components; this server component is just the shell.
 */
import { CreateForm } from "@/components/create/create-form";
import { QueueStrip } from "@/components/create/queue-strip";

export default function CreatePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Create</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Describe your song</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Forge a full track on this Mac, then open it in the library to edit a section or extend it.
        </p>
      </div>
      <div className="flex flex-col gap-6">
        <CreateForm />
        <QueueStrip />
      </div>
    </main>
  );
}
