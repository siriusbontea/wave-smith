/**
 * components/settings/phone-access.tsx — turn on LAN pairing from Settings.
 *
 * The QR is rendered from an SVG the server built. The code is not fetched
 * when this page is opened through a paired phone.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface PhoneStatus {
  enabled: boolean;
  listening: boolean;
  error: string | null;
  port: number;
  urls: string[];
  invite: { code: string; url: string | null; qrSvg: string | null } | null;
  devices: Array<{ id: string; label: string; createdAt: number; lastSeenAt: number | null }>;
  via: "mac" | "phone";
}

async function fetchPhone(): Promise<PhoneStatus> {
  const res = await fetch("/api/phone", { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't load phone access");
  return res.json() as Promise<PhoneStatus>;
}

async function postPhone(body: { action: string; deviceId?: string }): Promise<PhoneStatus> {
  const res = await fetch("/api/phone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as PhoneStatus & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Couldn't change phone access");
  return data;
}

export function PhoneAccess() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["phone"],
    queryFn: fetchPhone,
    refetchInterval: (query) => (query.state.data?.enabled ? 2000 : false),
  });
  const mutation = useMutation({
    mutationFn: postPhone,
    onSuccess: (next) => {
      queryClient.setQueryData(["phone"], next);
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    },
    onError: (err) => toast.error("Phone access", { description: err.message }),
  });

  if (isLoading || !data) {
    return (
      <section className="rounded-xl border bg-card p-4" data-testid="phone-access">
        <h2 className="font-medium">Use from a phone</h2>
        <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }

  if (data.via === "phone") {
    return (
      <section className="rounded-xl border bg-card p-4" data-testid="phone-access">
        <h2 className="font-medium">Use from a phone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This phone is paired. Songs are still made on the computer. To turn this off or remove a
          phone, use Settings on that computer.
        </p>
      </section>
    );
  }

  const on = data.enabled && data.listening;
  return (
    <section className="rounded-xl border bg-card p-4" data-testid="phone-access">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Use from a phone</h2>
          <p className="mt-1 text-sm" role="status" data-testid="phone-status">
            {on
              ? "On. A phone on your Wi-Fi can pair. The music still happens on this computer."
              : "Off. Only this computer can open Wavesmith."}
          </p>
        </div>
        <Button
          type="button"
          variant={on ? "outline" : "default"}
          data-testid="phone-toggle"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ action: data.enabled ? "disable" : "enable" })}
        >
          {data.enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>
      {data.error ? (
        <p className="mt-3 text-sm text-destructive" role="status">
          {data.error}
        </p>
      ) : null}
      {data.enabled && data.urls.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No Wi-Fi address yet. Join a network, then turn this off and on again.
        </p>
      ) : null}
      {on && data.invite ? (
        <div className="mt-4">
          <p className="text-sm">On the phone, open the camera and scan this code.</p>
          {data.invite.qrSvg?.trimStart().startsWith("<svg") ? (
            <div
              role="img"
              aria-label="Pairing code"
              data-testid="phone-qr"
              className="mt-3 size-52 rounded-lg bg-white p-2 [&_svg]:size-full"
              dangerouslySetInnerHTML={{ __html: data.invite.qrSvg }}
            />
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">
            Or type this code after opening the address below.
          </p>
          <p className="mt-1 font-mono text-lg tracking-widest" data-testid="phone-code">
            {data.invite.code}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {data.urls.map((url) => (
              <li key={url}>
                <a className="underline" href={url}>
                  {url}
                </a>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: "rotate" })}
          >
            New code
          </Button>
        </div>
      ) : null}
      {data.devices.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {data.devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{device.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: "revoke", deviceId: device.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Anyone on your Wi-Fi who can see the code can pair until you remove them. The music engine
        stays on this computer. Do not forward this port to the internet.
      </p>
    </section>
  );
}
