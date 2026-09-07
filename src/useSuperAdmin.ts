import { useCallback, useState } from "react";
import { useCloudAuth } from "@/cloud/auth";
import { readSuperAdminEnabled, writeSuperAdminEnabled } from "@/cloud/adminPrefs";
import { canToggleSuperAdmin, superAdminSees } from "@/lib/superAdmin";

/**
 * The super admin switch, wired to the session.
 *
 * Two booleans rather than one, because they answer different questions and
 * conflating them is how a control ends up on somebody else's screen:
 * `offered` is whether this account may touch the switch at all, and `on` is
 * whether identities are showing right now.
 *
 * `on` is recomputed against the live session every render, so signing out
 * takes the addresses off the screen without anything having to remember to
 * clear the stored preference. `lib/superAdmin.ts` is where that argument
 * lives; this is only the plumbing.
 */
export interface SuperAdmin {
  /** Show the switch. */
  offered: boolean;
  /** Show the identities. */
  on: boolean;
  set: (enabled: boolean) => void;
}

export function useSuperAdmin(): SuperAdmin {
  const { user } = useCloudAuth();
  const [enabled, setEnabled] = useState(readSuperAdminEnabled);

  const set = useCallback((next: boolean) => {
    writeSuperAdminEnabled(next);
    setEnabled(next);
  }, []);

  return {
    offered: canToggleSuperAdmin(user?.email),
    on: superAdminSees(user?.email, enabled),
    set,
  };
}
