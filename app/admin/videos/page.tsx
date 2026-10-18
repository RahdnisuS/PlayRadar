import { notFound } from "next/navigation";
import { VideoEvalList } from "@/components/VideoEvalList";
import { isAdmin } from "@/lib/auth/admin";
import { listEvalItems } from "@/lib/video/eval";

export const metadata = { title: "Video labelling — PlayRadar", robots: { index: false } };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Owner-only: hand-label the 50-game video evaluation set that /metrics reports accuracy on. */
export default async function AdminVideos() {
  if (!(await isAdmin())) notFound();
  return <VideoEvalList initial={await listEvalItems()} />;
}
