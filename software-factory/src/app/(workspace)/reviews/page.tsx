import { redirect } from "next/navigation";
import { ReviewsWorkspace } from "@/components/factory/reviews-workspace";
import { getCurrentSession } from "@/lib/session";
import { getReviewsData } from "@/lib/workspace-data";

export default async function ReviewsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const prs = await getReviewsData(session.user.id);
  return <ReviewsWorkspace initialPrs={prs} />;
}
