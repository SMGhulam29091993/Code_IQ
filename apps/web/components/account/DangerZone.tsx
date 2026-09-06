"use client";

import { type FC, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { useDeleteInstallation } from "@/hooks/useInstallations";
import { useInstallationStore } from "@/store/installation.store";
import { getErrorMessage } from "@/lib/utils";

interface DangerZoneProps {
  installationId: string;
}

// .ai/knowledge/screens/account-screens.md "Screen: Account" — Workspace tab. Inline confirm
// dialog rather than a shared Modal primitive — this is the only place in the app that needs
// one so far; extract to components/ui/Modal.tsx if a second caller shows up.
export const DangerZone: FC<DangerZoneProps> = ({ installationId }) => {
  const router = useRouter();
  const clearActiveInstallation = useInstallationStore((s) => s.clearActiveInstallation);
  const deleteMutation = useDeleteInstallation();
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Keyboard-nav audit (.ai/plans/frontend.md Step 9): the confirm dialog is a plain div, not
  // a native <dialog>, so it gets no automatic focus move or Escape handling — added both here.
  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  function handleConfirm() {
    deleteMutation.mutate(installationId, {
      onSuccess: () => {
        clearActiveInstallation();
        router.push("/onboarding");
      },
    });
  }

  return (
    <div className="max-w-md rounded-card border border-red/20 bg-red/5 p-5">
      <h2 className="mb-1 font-display text-sm font-semibold text-red">Danger zone</h2>
      <p className="mb-4 text-xs leading-relaxed text-text2">
        Removing this installation deactivates every connected repository. This can be undone by
        reinstalling the GitHub App.
      </p>

      {!confirming && (
        <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          Remove installation
        </Button>
      )}

      {confirming && (
        <div role="alertdialog" aria-label="Confirm removal" className="flex flex-col gap-3">
          <p className="text-sm text-text">
            This will deactivate all repos. Are you sure?
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={handleConfirm}
              className="border-red/40 text-red hover:bg-red/10"
            >
              {deleteMutation.isPending ? "Removing..." : "Yes, remove it"}
            </Button>
            <Button
              ref={cancelRef}
              variant="ghost"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {deleteMutation.isError && <ErrorBanner message={getErrorMessage(deleteMutation.error)} />}
    </div>
  );
};
