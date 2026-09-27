import { redirect } from "next/navigation";
import { homePathFor } from "./(shell)/_shell/nav";
import { getShellViewer } from "./(shell)/_shell/viewer";

export const dynamic = "force-dynamic";

/** `/` (UX-3, BLD-8 R-2): kitchen users land on Kitchen, everyone else on Today. */
export default async function Page() {
  const viewer = await getShellViewer();
  redirect(homePathFor(viewer?.role ?? null));
}
