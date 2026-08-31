"use client";

import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";

import { useStudioStore } from "@/stores/studio-provider";

export function EditorDialog({ label, children, onClose }: Readonly<{
  label: string; children: ReactNode; onClose: () => void;
}>): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const errorMessage = useStudioStore((state) => state.errorMessage);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="m-auto max-h-[90vh] w-96 overflow-y-auto rounded-xl border border-white/15 bg-zinc-950 p-6 text-sm text-zinc-200 shadow-xl backdrop:bg-black/70 [&_button]:rounded [&_button]:border [&_button]:border-white/15 [&_button]:px-3 [&_button]:py-2 [&_button]:hover:bg-white/10 [&_button:disabled]:opacity-30 [&_select]:mt-2 [&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-white/15 [&_select]:bg-zinc-900 [&_select]:p-2 [&_input]:mt-2 [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:border-white/15 [&_input]:bg-zinc-900 [&_input]:p-2">
      <h2 className="mb-5 text-base font-medium">{label}</h2>
      {children}
      {errorMessage && <p role="alert" className="mt-4 text-xs text-rose-300">{errorMessage}</p>}
    </dialog>
  );
}
