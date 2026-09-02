"use client";

import { useEffect, useState } from "react";

import { useStudioStoreApi } from "@/stores/studio-provider";
import { getModelContext, registerWebMCPTools } from "@/webmcp/register";
import { createWebMCPTools } from "@/webmcp/tools";

export function WebMCPBridge(): null {
  const store = useStudioStoreApi();
  const [tools] = useState(() => createWebMCPTools(store, () => crypto.randomUUID()));

  useEffect(() => {
    const context = getModelContext(document);
    if (context === null) {
      store.getState().setWebMCPStatus("unsupported");
      return;
    }

    let active = true;
    store.getState().setWebMCPStatus("registering");
    const registration = registerWebMCPTools(context, tools);
    void registration.ready.then(
      () => { if (active) store.getState().setWebMCPStatus("ready"); },
      () => { if (active) store.getState().setWebMCPStatus("failed"); },
    );
    return () => {
      active = false;
      registration.unregister();
    };
  }, [store, tools]);

  return null;
}
