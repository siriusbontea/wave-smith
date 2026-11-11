/**
 * components/settings/phone-access.tsx — Tailscale pairing from Settings.
 *
 * The QR is an SVG the server built for this computer. A paired phone does
 * not receive the code.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withWavesmithHeaders } from "@/lib/client/api";

interface PhoneDevice {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number | null;
  lastAddress: string | null;
  userAgent: string | null;
}

interface PhoneStatus {
  enabled: boolean;
  listening: boolean;
  error: string | null;
  port: number;
  mode: "off" | "tailscale" | "lan";
  lan: boolean;
  urls: string[];
  invite: { code: string; url: string | null; qrSvg: string | null; expiresAt: number } | null;
  devices: PhoneDevice[];
  via: "mac" | "phone";
}

async function fetchPhone(): Promise<PhoneStatus> {
  const res = await fetch("/api/phone", { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't load phone access");
  return res.json() as Promise<PhoneStatus>;
}

async function postPhone(body: { action: string; deviceId?: string; name?: string }): Promise<PhoneStatus> {
  const res = await fetch(
    "/api/phone",
    withWavesmithHeaders({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const data = (await res.json()) as PhoneStatus & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Couldn't change phone access");
  return data;
}

function when(ms: number | null): string {
  if (ms == null) return "not yet";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CodeClock({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  if (now == null) return <p className="mt-1 text-sm text-muted-foreground">This code works for 10 minutes.</p>;
  const left = Math.max(0, expiresAt - now);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return (
    <p className="mt-1 text-sm text-muted-foreground">
      This code works for {minutes}:{seconds.toString().padStart(2, "0")}. Then a new one appears.
    </p>
  );
}

export function PhoneAccess() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["phone"],
    queryFn: fetchPhone,
    refetchInterval: (query) => (query.state.data?.enabled ? 2000 : false),
  });
  const seen = useRef<Set<string> | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!data || data.via === "phone") return;
    const ids = new Set(data.devices.map((device) => device.id));
    if (seen.current) {
      for (const device of data.devices) {
        if (!seen.current.has(device.id)) {
          toast("A phone paired", { description: device.label });
        }
      }
    }
    seen.current = ids;
  }, [data]);

  const mutation = useMutation({
    mutationFn: postPhone,
    onSuccess: (next) => {
      queryClient.setQueryData(["phone"], next);
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      setRename(null);
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
              ? data.mode === "lan"
                ? "On, for this Wi-Fi, until you quit Wavesmith. The music still happens on this computer."
                : "On through Tailscale. A phone signed in to the same Tailscale account can pair. The music still happens on this computer."
              : data.enabled
                ? "Phone access is on, but the door is closed."
                : "Off. Only this computer can open Wavesmith."}
          </p>
        </div>
        <Button
          type="button"
          variant={data.enabled ? "outline" : "default"}
          data-testid="phone-toggle"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ action: data.enabled ? "disable" : "enable" })}
        >
          {data.enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {data.enabled
          ? "Turn off closes the door and forgets every paired phone. The next time needs a new scan."
          : "Install Tailscale on this Mac and on the iPhone. Sign in to the same account. Then turn this on and scan the code."}
      </p>
      {data.error ? (
        <p className="mt-3 text-sm text-destructive" role="status">
          {data.error}
        </p>
      ) : null}
      {data.enabled && !data.listening ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          data-testid="phone-recheck"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ action: "recheck" })}
        >
          Check again
        </Button>
      ) : null}
      {on && data.invite ? (
        <div className="mt-4">
          <p className="text-sm">On the phone, open the camera and scan this code. Then tap Pair.</p>
          {data.invite.qrSvg?.trimStart().startsWith("<svg") ? (
            <div
              role="img"
              aria-label="Pairing code"
              data-testid="phone-qr"
              className="mt-3 size-52 rounded-lg bg-white p-2 [&_svg]:size-full"
              dangerouslySetInnerHTML={{ __html: data.invite.qrSvg }}
            />
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">Or type this code on the phone.</p>
          <p className="mt-1 font-mono text-lg tracking-widest" data-testid="phone-code">
            {data.invite.code}
          </p>
          <CodeClock expiresAt={data.invite.expiresAt} />
          <ul className="mt-2 space-y-1 text-sm">
            {data.urls.map((url) => (
              <li key={url}>
                <span className="font-mono text-xs">{url}</span>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            data-testid="phone-new-code"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: "rotate" })}
          >
            New code
          </Button>
        </div>
      ) : null}
      {data.devices.length > 0 ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Paired phones</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="phone-remove-all"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ action: "revoke-all" })}
            >
              Remove all
            </Button>
          </div>
          <ul className="mt-2 flex flex-col gap-3">
            {data.devices.map((device) => (
              <li key={device.id} className="text-sm" data-testid="phone-device">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{device.label}</span>
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() => setRename({ id: device.id, name: device.label })}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ action: "revoke", deviceId: device.id })}
                    >
                      Remove
                    </Button>
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Paired {when(device.createdAt)}
                  {" · "}
                  Last seen {when(device.lastSeenAt)}
                  {device.lastAddress ? ` · ${device.lastAddress}` : ""}
                </p>
                {rename?.id === device.id ? (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      mutation.mutate({ action: "rename", deviceId: device.id, name: rename.name });
                    }}
                  >
                    <Input
                      value={rename.name}
                      onChange={(event) => setRename({ id: device.id, name: event.target.value })}
                      maxLength={40}
                      aria-label="Phone name"
                    />
                    <Button type="submit" size="sm" disabled={mutation.isPending}>
                      Save
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 rounded-lg border border-dashed p-3">
        <h3 className="text-sm font-medium">Home Wi-Fi (advanced)</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This is plain HTTP. Anyone on the same Wi-Fi who can see the code can try to pair. It
          lasts until you quit Wavesmith. It does not turn back on after a restart. Tailscale is
          the way to use a phone.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          data-testid="phone-lan"
          disabled={mutation.isPending || !data.enabled}
          onClick={() => mutation.mutate({ action: data.lan ? "lan-off" : "lan-on" })}
        >
          {data.lan ? "Stop home Wi-Fi" : "Also allow this Wi-Fi"}
        </Button>
      </div>
    </section>
  );
}
